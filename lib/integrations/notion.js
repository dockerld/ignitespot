import axios from "axios";

const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const NOTION_CLIENT_NAMES_DB_ID = process.env.NOTION_CLIENT_NAMES_DB_ID || "";
const NOTION_CLIENT_SOFTWARE_DB_ID = process.env.NOTION_CLIENT_SOFTWARE_DB_ID || "";
const NOTION_VERSION = "2022-06-28";

function hasNotionConfig() {
  return !!NOTION_TOKEN && !!NOTION_CLIENT_NAMES_DB_ID;
}

async function notionRequest(method, path, data) {
  const resp = await axios({
    method,
    url: `https://api.notion.com/v1${path}`,
    data,
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    timeout: 15000,
  });
  return resp.data;
}

// ============================================================
// Field mapping: Airtable field names → Notion property builders
// ============================================================

// Client Names table field map
const CLIENT_NAMES_FIELD_MAP = {
  "Group Name": (v) => ({ title: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Sub Name": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Company Name": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "QBO File Name": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "HubSpot Contact": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "DBA": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Main Contact": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Email": (v) => (v && String(v).includes("@") ? { email: String(v) } : null),
  "Primary Contact Email": (v) => (v && String(v).includes("@") ? { email: String(v) } : null),
  "Main Contact Phone": (v) => ({ phone_number: String(v) }),
  "Physical Address (if different from billing)": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Billing Address": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Recurring Billing": (v) => ({ number: Number(v) || null }),
  "Project Fee": (v) => ({ number: Number(v) || null }),
  "HubSpot Deal ID": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "HubSpot Company ID": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Client Software List": null, // Handled as relation separately
};

// Airtable "Email" maps to Notion "Primary Contact Email"
const CLIENT_NAMES_RENAME_MAP = {
  "Email": "Primary Contact Email",
};

// Client Software table field map
const CLIENT_SOFTWARE_FIELD_MAP = {
  "Group Name": (v) => ({ title: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Close Out": (v) => ({ select: { name: String(v).replace(/,/g, ";") } }),
  "Services": (v) => {
    const arr = Array.isArray(v) ? v : [v];
    return { multi_select: arr.filter(Boolean).map((s) => ({ name: String(s).replace(/,/g, ";") })) };
  },
  "CFO Frequency": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Controller Frequency": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Accounting Frequency": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Payroll Software": (v) => {
    const arr = Array.isArray(v) ? v : [v];
    return { multi_select: arr.filter(Boolean).map((s) => ({ name: String(s).replace(/,/g, ";") })) };
  },
  "HubSpot Deal ID": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Accountant": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Controller": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "CFO": (v) => ({ rich_text: [{ text: { content: String(v).slice(0, 2000) } }] }),
  "Contact": null, // Handled as relation separately
};

function buildNotionProperties(fields, fieldMap, renameMap = {}) {
  const props = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string" && value.trim() === "") continue;

    // Skip relation fields handled separately
    const mapper = fieldMap[key];
    if (mapper === null) continue;

    const notionKey = renameMap[key] || key;

    if (mapper) {
      const built = mapper(value);
      if (built) props[notionKey] = built;
    }
  }
  return props;
}

// ============================================================
// CRUD operations
// ============================================================

export async function createNotionRecord(fields, dbId = NOTION_CLIENT_NAMES_DB_ID) {
  if (!hasNotionConfig()) return null;

  const isClientSoftware = dbId === NOTION_CLIENT_SOFTWARE_DB_ID;
  const fieldMap = isClientSoftware ? CLIENT_SOFTWARE_FIELD_MAP : CLIENT_NAMES_FIELD_MAP;
  const renameMap = isClientSoftware ? {} : CLIENT_NAMES_RENAME_MAP;
  const properties = buildNotionProperties(fields, fieldMap, renameMap);

  if (!Object.keys(properties).length) return null;

  try {
    const result = await notionRequest("POST", "/pages", {
      parent: { database_id: dbId },
      properties,
    });
    console.log("✅ Notion record created:", { id: result.id, db: isClientSoftware ? "Client Software" : "Client Names" });
    return { id: result.id, properties: result.properties };
  } catch (err) {
    console.error("❌ Notion create error:", err?.response?.data?.message || err?.message || err);
    return null;
  }
}

export async function updateNotionRecordFields(pageId, fields, dbId = NOTION_CLIENT_NAMES_DB_ID) {
  if (!hasNotionConfig() || !pageId) return null;

  const isClientSoftware = dbId === NOTION_CLIENT_SOFTWARE_DB_ID;
  const fieldMap = isClientSoftware ? CLIENT_SOFTWARE_FIELD_MAP : CLIENT_NAMES_FIELD_MAP;
  const renameMap = isClientSoftware ? {} : CLIENT_NAMES_RENAME_MAP;
  const properties = buildNotionProperties(fields, fieldMap, renameMap);

  if (!Object.keys(properties).length) return null;

  try {
    const result = await notionRequest("PATCH", `/pages/${pageId}`, { properties });
    console.log("✅ Notion record updated:", { id: result.id });
    return { id: result.id, properties: result.properties };
  } catch (err) {
    console.error("❌ Notion update error:", err?.response?.data?.message || err?.message || err);
    return null;
  }
}

export async function findNotionRecordByField(fieldName, value, dbId = NOTION_CLIENT_NAMES_DB_ID) {
  if (!hasNotionConfig() || !value) return null;

  const strValue = String(value);

  // Title fields need a title filter, everything else is rich_text
  const TITLE_FIELDS = new Set(["Group Name", "Client Name"]);
  const filter = TITLE_FIELDS.has(fieldName)
    ? { property: fieldName, title: { equals: strValue } }
    : { property: fieldName, rich_text: { equals: strValue } };

  try {
    const result = await notionRequest("POST", `/databases/${dbId}/query`, {
      filter,
      page_size: 1,
    });
    const page = result?.results?.[0];
    if (!page) return null;

    // Convert Notion properties to a flat fields object for compatibility
    const fields = notionPropertiesToFields(page.properties);
    return { id: page.id, fields, notionPage: page };
  } catch (err) {
    console.error("❌ Notion find error:", err?.response?.data?.message || err?.message || err);
    return null;
  }
}

export async function searchNotionRecords(rawQuery, dbId = NOTION_CLIENT_NAMES_DB_ID) {
  if (!hasNotionConfig()) return [];

  const query = (rawQuery || "").trim();
  if (query.length < 3) return [];

  try {
    // Search by Group Name (title) — Sub Name only exists in Client Names DB
    const isClientNames = dbId === NOTION_CLIENT_NAMES_DB_ID;
    const filter = isClientNames
      ? {
          or: [
            { property: "Group Name", title: { contains: query } },
            { property: "Sub Name", rich_text: { contains: query } },
          ],
        }
      : { property: "Group Name", title: { contains: query } };

    const result = await notionRequest("POST", `/databases/${dbId}/query`, {
      filter,
      page_size: 50,
    });

    return (result?.results || []).map((page) => ({
      id: page.id,
      fields: notionPropertiesToFields(page.properties),
    }));
  } catch (err) {
    console.error("❌ Notion search error:", err?.response?.data?.message || err?.message || err);
    return [];
  }
}

export async function updateNotionRelation(pageId, relationProperty, targetPageIds) {
  if (!hasNotionConfig() || !pageId) return null;

  try {
    const result = await notionRequest("PATCH", `/pages/${pageId}`, {
      properties: {
        [relationProperty]: {
          relation: targetPageIds.map((id) => ({ id })),
        },
      },
    });
    return { id: result.id };
  } catch (err) {
    console.error("❌ Notion relation update error:", err?.response?.data?.message || err?.message || err);
    return null;
  }
}

// ============================================================
// Helpers
// ============================================================

function notionPropertiesToFields(properties) {
  const fields = {};
  for (const [key, prop] of Object.entries(properties || {})) {
    switch (prop.type) {
      case "title":
        fields[key] = prop.title?.map((t) => t.plain_text).join("") || "";
        break;
      case "rich_text":
        fields[key] = prop.rich_text?.map((t) => t.plain_text).join("") || "";
        break;
      case "number":
        fields[key] = prop.number;
        break;
      case "select":
        fields[key] = prop.select?.name || "";
        break;
      case "multi_select":
        fields[key] = (prop.multi_select || []).map((s) => s.name);
        break;
      case "checkbox":
        fields[key] = prop.checkbox || false;
        break;
      case "date":
        fields[key] = prop.date?.start || "";
        break;
      case "email":
        fields[key] = prop.email || "";
        break;
      case "phone_number":
        fields[key] = prop.phone_number || "";
        break;
      case "url":
        fields[key] = prop.url || "";
        break;
      case "relation":
        fields[key] = (prop.relation || []).map((r) => r.id);
        break;
      default:
        break;
    }
  }
  return fields;
}

export function formatNotionOption(record) {
  const fields = record?.fields || {};
  const groupName = fields["Group Name"] || "";
  const subName = fields["Sub Name"] || "";
  const display = groupName || "Unnamed";
  const secondary = subName && subName !== groupName ? subName : "";

  return {
    text: { type: "plain_text", text: secondary ? `${display} — ${secondary}` : display },
    value: record.id,
  };
}

export { NOTION_CLIENT_NAMES_DB_ID, NOTION_CLIENT_SOFTWARE_DB_ID };
