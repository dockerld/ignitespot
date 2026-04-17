import { JWT } from "google-auth-library";
import axios from "axios";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.send";

const GOOGLE_SERVICE_ACCOUNT_EMAIL =
  process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY =
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";

function hasGmailConfig() {
  return !!GOOGLE_SERVICE_ACCOUNT_EMAIL && !!GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
}

async function getAccessToken(sendAsUser) {
  if (!hasGmailConfig()) {
    throw new Error("Gmail config missing.");
  }
  const key = GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n");
  const client = new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: [GMAIL_SCOPE],
    subject: sendAsUser,
  });
  const result = await client.getAccessToken();
  return typeof result === "string" ? result : result?.token || "";
}

function buildRawEmail({ from, to, subject, body }) {
  const lines = [
    "From: " + from,
    "To: " + to,
    "Subject: " + subject,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  const raw = lines.join("\r\n");
  return Buffer.from(raw)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendEmail({ from, to, subject, body }) {
  if (!hasGmailConfig()) {
    throw new Error("Gmail config missing.");
  }

  const token = await getAccessToken(from);
  const raw = buildRawEmail({ from, to, subject, body });

  const resp = await axios.post(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    { raw },
    {
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    }
  );

  return { sent: true, messageId: resp.data?.id };
}
