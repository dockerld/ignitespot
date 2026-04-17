const QBO_INVITE_CHANNEL_ID =
  process.env.QBO_INVITE_CHANNEL_ID || "C04RK1QFW6Q";

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

export async function handleQboInviteWebhook(payload, headers, options = {}) {
  const { slackClient, secret } = options;

  if (!verifyWebhookSecret(headers, secret)) {
    const err = new Error("Unauthorized QBO invite webhook.");
    err.statusCode = 401;
    throw err;
  }

  if (!slackClient) {
    throw new Error("Slack client missing.");
  }

  const companyName = payload?.companyName || "";
  const senderName = payload?.senderName || "";
  const senderEmail = payload?.senderEmail || "";
  const inviteLink = payload?.inviteLink || "";
  const inviteType = payload?.inviteType || "qbo";
  const bodyText =
    payload?.bodyText ||
    `${senderName || "Someone"} has invited you to access their books as an accountant user through QuickBooks Online Accountant.`;

  if (!companyName) {
    return { handled: false, reason: "missing_company_name" };
  }

  // Store client info in button value so the handler can access it
  const wrongEmailData = JSON.stringify({
    companyName,
    senderName,
    senderEmail,
    inviteType,
  });

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `Hey <!channel>, new QBO invite\n*Company:* ${companyName}`,
      },
    },
    {
      type: "actions",
      elements: [
        ...(inviteLink
          ? [
              {
                type: "button",
                text: { type: "plain_text", text: "Accept invite" },
                style: "primary",
                url: inviteLink,
                action_id: "qbo_accept_invite",
              },
            ]
          : []),
        {
          type: "button",
          text: { type: "plain_text", text: "Wrong Access Email" },
          style: "danger",
          action_id: "wrong_access_email",
          value: wrongEmailData,
        },
      ],
    },
    {
      type: "context",
      elements: [{ type: "mrkdwn", text: bodyText }],
    },
  ];

  await slackClient.chat.postMessage({
    channel: QBO_INVITE_CHANNEL_ID,
    text: `New QBO invite: ${companyName}`,
    blocks,
  });

  return { handled: true, companyName };
}
