import {
  SLACK_PROPOSAL_CHANGE_CHANNEL,
  PROPOSAL_CHANGE_WEBHOOK_SECRET,
} from "../env.js";

const recentProposalWebhookEvents = new Map();
const DEFAULT_DEDUPE_TTL_MS = 5 * 60 * 1000;

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
    text: statusText || "Proposal change request Status = Updated Proposal Sent - ✊",
  });

  return { handled: true };
}
