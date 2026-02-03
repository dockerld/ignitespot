import { SLACK_PROPOSAL_CHANGE_CHANNEL, PROPOSAL_CHANGE_WEBHOOK_SECRET } from "../env.js";

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
  const props = payload.properties || {};
  if (props.slack_thread_ts?.value) return String(props.slack_thread_ts.value);
  if (props.slack_thread_ts) return String(props.slack_thread_ts);
  return "";
}

export async function handleProposalChangeStatusWebhook(payload, headers, options = {}) {
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
