import {
  SLACK_DEFAULT_CHANNEL_ID,
  SLACK_SUPPORT_TICKET_CHANNEL_ID,
} from "../env.js";

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

export async function handleSupportTicketWebhook(payload, headers, options = {}) {
  const { slackClient, secret, defaultChannelId } = options;
  if (!verifyWebhookSecret(headers, secret)) {
    const err = new Error("Unauthorized support ticket webhook.");
    err.statusCode = 401;
    throw err;
  }
  if (!slackClient) {
    throw new Error("Slack client missing.");
  }

  const ticketStatus = payload?.ticket_status || "";
  const requester = payload?.requester || "";
  const threadTs = payload?.thread_ts || payload?.ts || payload?.message_ts || "";
  const channelId =
    payload?.channel_id ||
    defaultChannelId ||
    SLACK_SUPPORT_TICKET_CHANNEL_ID ||
    SLACK_DEFAULT_CHANNEL_ID;

  if (!channelId || !threadTs || !ticketStatus) {
    return { handled: false, reason: "missing_fields" };
  }

  const mentionText = requester ? `Hey ${requester},` : "";
  const text = `${mentionText}\nSupport Ticket Status = ${ticketStatus}`.trim();

  await slackClient.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text,
  });

  return { handled: true };
}
