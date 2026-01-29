import "dotenv/config";

export const HUBSPOT_TOKEN = process.env.HUBSPOT_PRIVATE_APP_TOKEN;
export const HUBSPOT_DEAL_TYPE_PROPERTY =
  process.env.HUBSPOT_DEAL_TYPE_PROPERTY || "dealtype";
export const HUBSPOT_HEAR_ABOUT_US_PROPERTY =
  process.env.HUBSPOT_HEAR_ABOUT_US_PROPERTY || "";
export const DOUBLE_CLIENT_ID = process.env.DOUBLE_CLIENT_ID;
export const DOUBLE_CLIENT_SECRET = process.env.DOUBLE_CLIENT_SECRET;
export const DOUBLE_BASE_URL = "https://api.doublehq.com";
export const AIRTABLE_TOKEN = process.env.AIRTABLE_TOKEN;
export const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
export const AIRTABLE_CLIENT_NAMES_TABLE_ID =
  process.env.AIRTABLE_CLIENT_NAMES_TABLE_ID || process.env.AIRTABLE_TABLE_ID || "";
export const AIRTABLE_TABLE_ID = AIRTABLE_CLIENT_NAMES_TABLE_ID;
export const AIRTABLE_SEARCH_FIELDS = process.env.AIRTABLE_SEARCH_FIELDS || "";
export const AIRTABLE_DISPLAY_FIELD = process.env.AIRTABLE_DISPLAY_FIELD || "";
export const AIRTABLE_SECONDARY_FIELD = process.env.AIRTABLE_SECONDARY_FIELD || "";
export const AIRTABLE_UPDATE_FIELD = process.env.AIRTABLE_UPDATE_FIELD || "";
export const AIRTABLE_UPDATE_VALUE = process.env.AIRTABLE_UPDATE_VALUE || "Slack TEst worked";
export const AIRTABLE_WEBHOOK_SECRET = process.env.AIRTABLE_WEBHOOK_SECRET || "";
export const AIRTABLE_CLIENT_SOFTWARE_TABLE_ID =
  process.env.AIRTABLE_CLIENT_SOFTWARE_TABLE_ID || "";
export const AIRTABLE_CLIENT_SOFTWARE_NAME_FIELD =
  process.env.AIRTABLE_CLIENT_SOFTWARE_NAME_FIELD || "Name";
export const HUBSPOT_WEBHOOK_SECRET = process.env.HUBSPOT_WEBHOOK_SECRET || "";
export const SLACK_PROPOSAL_CHANGE_CHANNEL =
  process.env.SLACK_PROPOSAL_CHANGE_CHANNEL || "#slack-bot-tests";
export const SLACK_PROPOSAL_CHANGE_REVIEWER_ID =
  process.env.SLACK_PROPOSAL_CHANGE_REVIEWER_ID || "";
export const SLACK_DEFAULT_MENTION_USER_ID =
  process.env.SLACK_DEFAULT_MENTION_USER_ID || "";
export const SLACK_DEFAULT_CHANNEL_ID =
  process.env.SLACK_DEFAULT_CHANNEL_ID || "";
export const HUBSPOT_PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || "";

export function logEnvStatus() {
  console.log("✅ Booting IgniteSpot Bot...");
  console.log("SLACK_BOT_TOKEN loaded:", !!process.env.SLACK_BOT_TOKEN);
  console.log("SLACK_SIGNING_SECRET loaded:", !!process.env.SLACK_SIGNING_SECRET);
  console.log("HUBSPOT token loaded:", !!HUBSPOT_TOKEN);
  console.log("DOUBLE client ID loaded:", !!DOUBLE_CLIENT_ID);
  console.log("DOUBLE client secret loaded:", !!DOUBLE_CLIENT_SECRET);
  console.log("AIRTABLE token loaded:", !!AIRTABLE_TOKEN);
  console.log("AIRTABLE base ID loaded:", !!AIRTABLE_BASE_ID);
  console.log("AIRTABLE client names table loaded:", !!AIRTABLE_CLIENT_NAMES_TABLE_ID);
  console.log(
    "AIRTABLE client software table loaded:",
    !!AIRTABLE_CLIENT_SOFTWARE_TABLE_ID
  );
  console.log(
    "GOOGLE Drive config loaded:",
    !!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL &&
      !!process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
      !!process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID
  );
}
