import {
  SLACK_PROPOSAL_CHANGE_CHANNEL,
  PROPOSAL_CHANGE_WEBHOOK_SECRET,
} from "../env.js";

const recentProposalWebhookEvents = new Map();
const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const STAGE_CHANGE_DEDUPE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const PROPOSAL_STAGE_MESSAGES = {
  "61074700": "Proposal change request Status = In Progress/Review - ⏳",
  "36250123": "Proposal change request Status = Updated Proposal Sent - ✍️",
  "36250124": "Proposal change request Status = Closed/Won - ✅",
  "36250125": "Proposal change request Status = Closed/Declined - ✅",
};
const PROPOSAL_STAGE_REACTIONS = {
  "61074700": "hourglass",
  "36250123": "writing_hand",
  "36250124": "white_check_mark",
};
const CLOSED_WON_STAGE_IDS = new Set(["36250124"]);
const CLOSED_DECLINED_STAGE_IDS = new Set(["36250125"]);

function getPayloadProperties(payload) {
  return payload?.properties || payload?.deal?.properties || payload?.object?.properties || {};
}

function readPropertyValue(entry) {
  if (entry === undefined || entry === null) return "";
  if (typeof entry === "object") {
    if ("value" in entry) return entry.value;
    if ("string" in entry) return entry.string;
  }
  return entry;
}

function getHeader(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find(
    (header) => header.toLowerCase() === name.toLowerCase()
  );
  return key ? headers[key] : "";
}

function verifyWebhookSecret(headers, secret) {
  if (!secret) return true;
  const direct = getHeader(headers, "x-webhook-secret");
  const auth = getHeader(headers, "authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";
  return direct === secret || token === secret;
}

function getSlackThreadTs(payload) {
  if (!payload) return "";
  if (payload.slack_thread_ts) return String(payload.slack_thread_ts);
  const props = getPayloadProperties(payload);
  if (props.slack_thread_ts?.value) return String(props.slack_thread_ts.value);
  if (props.slack_thread_ts) return String(props.slack_thread_ts);
  if (props?.slack_thread_ts?.string) return String(props.slack_thread_ts.string);
  if (payload.deal?.slack_thread_ts) return String(payload.deal.slack_thread_ts);
  return "";
}

function getDealStageId(payload) {
  if (!payload) return "";
  if (payload.dealstage) return String(readPropertyValue(payload.dealstage));
  const props = getPayloadProperties(payload);
  const stage = readPropertyValue(props.dealstage);
  if (stage) return String(stage);
  return "";
}

function getDealObjectId(payload) {
  const props = getPayloadProperties(payload);
  return String(
    payload?.objectId ||
      payload?.dealId ||
      readPropertyValue(props.hs_object_id) ||
      ""
  );
}

function getDealStageChangeTimestamp(payload) {
  const props = getPayloadProperties(payload);
  const candidates = [
    payload?.dealstage_timestamp,
    payload?.stage_changed_at,
    props?.dealstage?.timestamp,
    props?.dealstage?.versions?.[0]?.timestamp,
    readPropertyValue(props?.hs_v2_date_entered_current_stage),
    readPropertyValue(props?.hs_date_entered_current_deal_stage),
  ];

  for (const candidate of candidates) {
    if (candidate !== undefined && candidate !== null && String(candidate) !== "") {
      return String(candidate);
    }
  }
  return "";
}

function getDedupeKey(payload, headers, statusText, threadTs, stageId) {
  const objectId = getDealObjectId(payload);
  const stageChangedAt = getDealStageChangeTimestamp(payload);
  if (objectId && stageId && stageChangedAt) {
    return `stage:${objectId}|${stageId}|${stageChangedAt}`;
  }

  const direct =
    payload?.eventId ||
    payload?.id ||
    payload?.webhookId ||
    payload?.occurredAt ||
    payload?.timestamp ||
    payload?.time;
  if (direct) return `event:${direct}`;
  const correlation =
    getHeader(headers, "x-hubspot-correlation-id") ||
    getHeader(headers, "x-hubspot-request-id") ||
    getHeader(headers, "x-request-id");
  if (correlation) return `corr:${correlation}`;
  return `fallback:${objectId}|${threadTs}|${statusText || ""}`;
}

function markAndCheckDuplicate(key, ttlMs = DEFAULT_DEDUPE_TTL_MS) {
  const now = Date.now();
  const last = recentProposalWebhookEvents.get(key);
  if (last && now - last < ttlMs) return true;
  recentProposalWebhookEvents.set(key, now);
  return false;
}

function getDedupeTtlMs(key) {
  if (key?.startsWith("stage:")) return STAGE_CHANGE_DEDUPE_TTL_MS;
  return DEFAULT_DEDUPE_TTL_MS;
}

async function addReactionSafely(slackClient, params) {
  try {
    await slackClient.reactions.add(params);
  } catch (err) {
    const code = err?.data?.error || err?.code || "unknown_reaction_error";
    if (code !== "already_reacted") {
      console.warn("⚠️ Proposal change reaction skipped:", {
        code,
        channel: params?.channel,
        timestamp: params?.timestamp,
        name: params?.name,
      });
    }
  }
}

export async function handleProposalChangeStatusWebhook(
  payload,
  headers,
  options = {}
) {
  const { slackClient, channelId, secret, statusText } = options;
  if (!verifyWebhookSecret(headers, secret)) {
    const err = new Error("Unauthorized proposal change webhook.");
    err.statusCode = 401;
    throw err;
  }
  if (!slackClient) {
    throw new Error("Slack client missing.");
  }

  const threadTs = getSlackThreadTs(payload);
  const channel = channelId || SLACK_PROPOSAL_CHANGE_CHANNEL;
  const stageId = getDealStageId(payload);
  const resolvedStatusText =
    PROPOSAL_STAGE_MESSAGES[stageId] ||
    statusText ||
    "Proposal change request Status = Updated Proposal Sent - ✊";
  const dedupeKey = getDedupeKey(payload, headers, statusText, threadTs, stageId);

  if (markAndCheckDuplicate(dedupeKey, getDedupeTtlMs(dedupeKey))) {
    return { handled: false, reason: "duplicate" };
  }

  if (!channel || !threadTs) {
    return { handled: false, reason: "missing_thread" };
  }

  const statusMessage = await slackClient.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: resolvedStatusText,
  });
  const statusMessageTs =
    statusMessage?.ts || statusMessage?.message?.ts || threadTs;

  const reaction = PROPOSAL_STAGE_REACTIONS[stageId];
  if (reaction) {
    await addReactionSafely(slackClient, {
      channel,
      timestamp: statusMessageTs,
      name: reaction,
    });
  }

  if (CLOSED_DECLINED_STAGE_IDS.has(stageId)) {
    await addReactionSafely(slackClient, {
      channel,
      timestamp: statusMessageTs,
      name: "x",
    });
  }

  return { handled: true };
}
