import axios from "axios";
import { JWT } from "google-auth-library";

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || "";
const GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY =
  process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "";
const GOOGLE_DRIVE_PARENT_FOLDER_ID = process.env.GOOGLE_DRIVE_PARENT_FOLDER_ID || "";
const GOOGLE_DRIVE_IMPERSONATE_USER = process.env.GOOGLE_DRIVE_IMPERSONATE_USER || "";
const GOOGLE_DRIVE_SHARE_DOMAIN = process.env.GOOGLE_DRIVE_SHARE_DOMAIN || "";
const GOOGLE_DRIVE_SHARE_ROLE = process.env.GOOGLE_DRIVE_SHARE_ROLE || "writer";
const GOOGLE_DRIVE_SHARE_NOTIFY = process.env.GOOGLE_DRIVE_SHARE_NOTIFY === "true";

const DRIVE_ALPHA_PARENT_IDS = {
  "#": "1sbI_BFwgV6aJsxQJBonWPkhsRubjvVLW",
  A: "1f74TW_yWBUbGz_moRDoCIILhu0SWgx8y",
  B: "1wL0HgbEw5jB-1LR7wtJ_-eW1hc8jw05s",
  C: "1_RvaUQ8ROXhosSji-OKjAZeA_ccXvSIt",
  D: "1iWOm45kDXQAufle6VTFyoGPn7W-vI-Zr",
  E: "1E5Razh3anDWqVwskhSVGyx_6LoATHVmC",
  F: "1PHrJnP6N9GaSi5hHTk2kPo_XLtt0zdgH",
  G: "1xOYqyPeWN8g9II3UmIdDjjymL7bxXg4v",
  H: "1hSz41LQ9nPys_qWjk7YfZX6t9Ur8eKSe",
  I: "1KYqiFlIltQd3n-CZp5t-CAM9-S8tkiyN",
  J: "1MzW2ReZIL7jMTIWFsFSqeDrqk-WA_IK3",
  K: "1PHRfW7CTpZilXCPnk9AT-mrCFT0Om9Hv",
  L: "169QXjQI-16TJLuHbPtRJr6l96_9JXNHy",
  M: "1M2uhWLIeZ4Ckix99I_oqamN7FXTl34Rk",
  N: "1vHq9GZ7KGrSy9Nk707Ih7duPc9p-6_Kf",
  O: "1SreJgfqYdRbwK45FW27cBm7deG0-od0B",
  P: "1-v9nTTDOJjQSfWezZlpZYJXTmlZgbVe1",
  Q: "11e-CBTt_uYTIAahtBY-GXoSZojP4mYet",
  R: "1B4CtYdNPmQMjJ-I1uOJ2eYWhdA4FWd51",
  S: "1uVbAMNkGdCTNX80Sr3C_D0IRjG7ceDDy",
  T: "1apgKUNyhSSonFb9X7MfpP8BeOzEQlhHJ",
  U: "1zWPj1ULnZFcRw1TZiiLwVTgHz80Xu9x4",
  V: "1BO8SamZPVCN0gS9BMhGJBHTD30yAF8ui",
  W: "1Rp9ZYe6pH1E8wrMQf_3sAsA8WSxImN_w",
  X: "11r8128NiTX70BqELqLbeiY-IbNX0XzaU",
  Y: "1bh2iiGpiC9_hx4CjmuwsmYsEoHjAkjp8",
  Z: "1M4AYDXr4g0H2-GaxR06YjbqEdS3ZrMB5",
};

const CLIENT_FOLDER_TEMPLATE_PATHS = [
  ["Accounting Documents"],
  ["Accounting Documents", "1 - To Be Processed"],
  ["Accounting Documents", "2 - Archived"],
  ["Accounting Documents", "2 - Archived", "1 - Accounts Payable"],
  ["Accounting Documents", "2 - Archived", "2 - Accounting Receivable"],
  ["Accounting Documents", "2 - Archived", "3 - Account Reconciliation"],
  ["Accounting Documents", "2 - Archived", "4 - Financial Institution Statements"],
  ["Accounting Documents", "2 - Archived", "5 - Tax Filings"],
  ["Accounting Documents", "2 - Archived", "6 - Special Reports"],
  ["Accounting Documents", "2 - Archived", "7 - Financials"],
  ["Accounting Documents", "3 - Recurring Hard Documents"],
  ["Accounting Documents", "3 - Recurring Hard Documents", "1 - Loan Documents"],
  ["Accounting Documents", "3 - Recurring Hard Documents", "2 - Amortization Schedules"],
  ["Accounting Documents", "3 - Recurring Hard Documents", "3 - Prepaid Schedules"],
  ["Accounting Documents", "3 - Recurring Hard Documents", "4 - Lease Agreements"],
  ["Accounting Documents", "3 - Recurring Hard Documents", "5 - Other Supporting Material"],
  ["Accounting Documents", "4 - Playbooks"],
  ["Internal Documents"],
  ["Internal Documents", "1 - Active Work Papers"],
  ["Internal Documents", "2 - Mgt Review Documents"],
  ["Internal Documents", "3 - Proposal Change"],
];

function hasDriveConfig() {
  return !!GOOGLE_SERVICE_ACCOUNT_EMAIL && !!GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY;
}

function buildJwtClient() {
  if (!hasDriveConfig()) {
    throw new Error("Google Drive config missing.");
  }
  const key = GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY.replace(/\\n/g, "\n");
  return new JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key,
    scopes: [DRIVE_SCOPE],
    subject: GOOGLE_DRIVE_IMPERSONATE_USER || undefined,
  });
}

async function getAccessToken() {
  const client = buildJwtClient();
  const result = await client.getAccessToken();
  if (typeof result === "string") return result;
  return result?.token || "";
}

async function listFoldersByName(name, parentId, token) {
  if (!token) throw new Error("Google Drive access token missing.");

  const q = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${String(name).replace(/'/g, "\\'")}'`,
    `trashed = false`,
    `'${parentId}' in parents`,
  ].join(" and ");

  const resp = await axios.get("https://www.googleapis.com/drive/v3/files", {
    params: {
      q,
      pageSize: 1,
      fields: "files(id,name,webViewLink)",
      corpora: "allDrives",
      includeItemsFromAllDrives: true,
      supportsAllDrives: true,
    },
    headers: {
      Authorization: `Bearer ${token}`,
    },
    timeout: 10000,
  });

  return resp.data?.files?.[0] || null;
}

async function createFolder(name, parentId, token) {
  if (!token) throw new Error("Google Drive access token missing.");

  const resp = await axios.post(
    "https://www.googleapis.com/drive/v3/files",
    {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    {
      params: {
        fields: "id,name,webViewLink",
        supportsAllDrives: true,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    }
  );

  return resp.data;
}

async function listFolderChildren(parentId, token) {
  if (!token) throw new Error("Google Drive access token missing.");

  const q = [
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    `'${parentId}' in parents`,
  ].join(" and ");

  let pageToken;
  const files = [];
  do {
    const resp = await axios.get("https://www.googleapis.com/drive/v3/files", {
      params: {
        q,
        pageToken,
        pageSize: 1000,
        fields: "nextPageToken,files(id,name,webViewLink)",
        corpora: "allDrives",
        includeItemsFromAllDrives: true,
        supportsAllDrives: true,
      },
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
    });
    files.push(...(resp.data?.files || []));
    pageToken = resp.data?.nextPageToken || "";
  } while (pageToken);

  return files;
}

async function ensureDomainPermission(fileId, token) {
  if (!GOOGLE_DRIVE_SHARE_DOMAIN) return { shared: false };
  if (!token) throw new Error("Google Drive access token missing.");

  try {
    await axios.post(
      `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
      {
        type: "domain",
        role: GOOGLE_DRIVE_SHARE_ROLE,
        domain: GOOGLE_DRIVE_SHARE_DOMAIN,
        allowFileDiscovery: false,
      },
      {
        params: {
          supportsAllDrives: true,
          sendNotificationEmail: GOOGLE_DRIVE_SHARE_NOTIFY,
        },
        headers: {
          Authorization: `Bearer ${token}`,
        },
        timeout: 10000,
      }
    );
    return { shared: true };
  } catch (err) {
    const status = err?.response?.status;
    const reason = err?.response?.data?.error?.errors?.[0]?.reason;
    const message = err?.response?.data?.error?.message || err?.message || "";
    const duplicate =
      status === 409 ||
      reason === "duplicate" ||
      message.toLowerCase().includes("already has access") ||
      message.toLowerCase().includes("duplicate");
    if (duplicate) {
      return { shared: true, duplicate: true };
    }
    console.error("❌ Google Drive share error:", status, message);
    return { shared: false };
  }
}

function resolveAlphabetKey(companyName) {
  const trimmed = String(companyName || "").trim();
  const match = trimmed.match(/[A-Za-z0-9]/);
  if (!match) return "#";
  const ch = match[0].toUpperCase();
  if (ch >= "A" && ch <= "Z") return ch;
  if (ch >= "0" && ch <= "9") return "#";
  return "#";
}

function resolveParentFolderId(companyName) {
  const alphaKey = resolveAlphabetKey(companyName);
  return DRIVE_ALPHA_PARENT_IDS[alphaKey] || GOOGLE_DRIVE_PARENT_FOLDER_ID || "";
}

async function ensureFolderPath(rootId, pathParts, token, childrenCache) {
  let currentId = rootId;
  for (const part of pathParts) {
    let children = childrenCache.get(currentId);
    if (!children) {
      const list = await listFolderChildren(currentId, token);
      children = new Map(list.map((item) => [item.name, item]));
      childrenCache.set(currentId, children);
    }

    let existing = children.get(part);
    if (!existing) {
      existing = await createFolder(part, currentId, token);
      children.set(part, existing);
    }
    currentId = existing.id;
  }
  return currentId;
}

export async function ensureCompanyFolder(companyName) {
  if (!hasDriveConfig()) return null;
  if (!companyName) return null;

  const parentFolderId = resolveParentFolderId(companyName);
  if (!parentFolderId) return null;

  const token = await getAccessToken();
  if (!token) throw new Error("Google Drive access token missing.");

  const existing = await listFoldersByName(companyName, parentFolderId, token);
  if (existing) {
    const childrenCache = new Map();
    await Promise.all(
      CLIENT_FOLDER_TEMPLATE_PATHS.map((pathParts) =>
        ensureFolderPath(existing.id, pathParts, token, childrenCache)
      )
    );
    const shareResult = await ensureDomainPermission(existing.id, token);
    return { ...existing, created: false, shared: shareResult.shared };
  }

  const created = await createFolder(companyName, parentFolderId, token);
  const childrenCache = new Map();
  await Promise.all(
    CLIENT_FOLDER_TEMPLATE_PATHS.map((pathParts) =>
      ensureFolderPath(created.id, pathParts, token, childrenCache)
    )
  );
  const shareResult = await ensureDomainPermission(created.id, token);
  return { ...created, created: true, shared: shareResult.shared };
}
