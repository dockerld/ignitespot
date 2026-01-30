import axios from "axios";
import { JWT } from "google-auth-library";
import {
  GOOGLE_SHEETS_SPREADSHEET_ID,
  GOOGLE_SHEETS_OPEN_SHEET_NAME,
  GOOGLE_SERVICE_ACCOUNT_EMAIL,
  GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
} from "../env.js";

const SHEETS_SCOPE = "https://www.googleapis.com/auth/spreadsheets";

function hasSheetsConfig() {
  return (
    !!GOOGLE_SERVICE_ACCOUNT_EMAIL &&
    !!GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY &&
    !!GOOGLE_SHEETS_SPREADSHEET_ID &&
    !!GOOGLE_SHEETS_OPEN_SHEET_NAME
  );
}

function buildJwtClient() {
  if (!GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY) {
    throw new Error("Google Sheets service account config missing.");
  }
  const key = GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n");
  return new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: [SHEETS_SCOPE],
  });
}

async function getAccessToken() {
  const client = buildJwtClient();
  const result = await client.getAccessToken();
  if (typeof result === "string") return result;
  return result?.token || "";
}

export async function appendSupportTicketRow(values) {
  if (!hasSheetsConfig()) {
    console.error("❌ Google Sheets append error: missing config.");
    return { appended: false, reason: "missing_config" };
  }
  const token = await getAccessToken();
  if (!token) throw new Error("Google Sheets access token missing.");

  const range = `${GOOGLE_SHEETS_OPEN_SHEET_NAME}!A:N`;
  const resp = await axios.post(
    `https://sheets.googleapis.com/v4/spreadsheets/${GOOGLE_SHEETS_SPREADSHEET_ID}/values/${encodeURIComponent(
      range
    )}:append`,
    {
      values: [values],
    },
    {
      params: {
        valueInputOption: "USER_ENTERED",
        insertDataOption: "INSERT_ROWS",
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );

  return { appended: true, updates: resp.data?.updates || {} };
}

