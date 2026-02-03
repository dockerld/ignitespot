import {
  SLACK_PROPOSAL_CHANGE_CHANNEL,
  PROPOSAL_CHANGE_WEBHOOK_SECRET,
} from "../env.js";

const recentProposalWebhookEvents = new Map();
const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;
const PROPOSAL_STAGE_MESSAGES = {
  "61074700": "Proposal change request Status = In Progress/Review - ✍️",
  "36250123": "Proposal change request Status = Updated Proposal Sent - ✍️",
  "36250124": "Proposal change request Status = Closed/Won - ✅",
  "36250125": "Proposal change request Status = Closed/Declined - ✅",
};
const CLOSED_WON_STAGE_IDS = new Set(["36250124"]);
const CLOSED_DECLINED_STAGE_IDS = new Set(["36250125"]);

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
  const props =
    payload.properties ||
    payload.deal?.properties ||
    payload.object?.properties ||
    {};
  if (props.slack_thread_ts?.value) return String(props.slack_thread_ts.value);
  if (props.slack_thread_ts) return String(props.slack_thread_ts);
  if (props?.slack_thread_ts?.string) return String(props.slack_thread_ts.string);
  if (payload.deal?.slack_thread_ts) return String(payload.deal.slack_thread_ts);
  return "";
}

function getDealStageId(payload) {
  if (!payload) return "";
  if (payload.dealstage) return String(payload.dealstage);
  const props =
    payload.properties ||
    payload.deal?.properties ||
    payload.object?.properties ||
    {};
  if (props.dealstage?.value) return String(props.dealstage.value);
  if (props.dealstage) return String(props.dealstage);
  return "";
}

function getDedupeKey(payload, headers, statusText, threadTs) {
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
  const objectId =
    payload?.objectId ||
    payload?.dealId ||
    payload?.properties?.hs_object_id?.value ||
    payload?.properties?.hs_object_id ||
    "";
  return `fallback:${objectId}|${threadTs}|${statusText || ""}`;
}

function markAndCheckDuplicate(key, ttlMs = DEFAULT_DEDUPE_TTL_MS) {
  const now = Date.now();
  const last = recentProposalWebhookEvents.get(key);
  if (last && now - last < ttlMs) return true;
  recentProposalWebhookEvents.set(key, now);
  return false;
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
  const dedupeKey = getDedupeKey(payload, headers, statusText, threadTs);

  if (markAndCheckDuplicate(dedupeKey)) {
    return { handled: false, reason: "duplicate" };
  }

  if (!channel || !threadTs) {
    return { handled: false, reason: "missing_thread" };
  }

  await slackClient.chat.postMessage({
    channel,
    thread_ts: threadTs,
    text: resolvedStatusText,
  });

  if (CLOSED_WON_STAGE_IDS.has(stageId)) {
    try {
      await slackClient.reactions.add({
        channel,
        timestamp: threadTs,
        name: "white_check_mark",
      });
    } catch (err) {
      if (err?.data?.error !== "already_reacted") {
        throw err;
      }
    }
  }

  if (CLOSED_DECLINED_STAGE_IDS.has(stageId)) {
    try {
      await slackClient.reactions.add({
        channel,
        timestamp: threadTs,
        name: "x",
      });
    } catch (err) {
      if (err?.data?.error !== "already_reacted") {
        throw err;
      }
    }
  }

  return { handled: true };
}
