import { AIRTABLE_WEBHOOK_SECRET } from "../env.js";
import {
  findHubSpotCompanyByNameExact,
  getHubSpotCompanyNameById,
  resolveHubSpotLifecycleStageValue,
  updateHubSpotLifecycleStage,
} from "../integrations/hubspot.js";

const CLOSE_OUT_FIELD = "Close Out";
const CLOSE_OUT_INACTIVE_VALUE = "inactive";
const HUBSPOT_COMPANY_ID_FIELD = "HubSpot Company ID (from Contact)";
const HUBSPOT_COMPANY_NAME_FIELDS = [
  "Group Name",
  "Company Name (from Contact) 2",
  "Sub Name (from Contact)",
];
const LIFECYCLE_STAGE_LABEL = "Former Client";
const LIFECYCLE_STAGE_FALLBACK = "former_client";

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function fieldValueToString(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map(fieldValueToString).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    if (typeof value.name === "string") return value.name;
    if (typeof value.id === "string" || typeof value.id === "number") {
      return String(value.id);
    }
    if (typeof value.email === "string") return value.email;
    try {
      return JSON.stringify(value);
    } catch (err) {
      return "";
    }
  }
  return String(value);
}

function extractFieldSets(payload) {
  if (!payload) return [];

  if (Array.isArray(payload.records)) {
    return payload.records
      .map((record) => record?.fields || record)
      .filter(Boolean);
  }

  if (payload.record?.fields) return [payload.record.fields];
  if (payload.data?.fields) return [payload.data.fields];
  if (payload.fields) return [payload.fields];

  if (Array.isArray(payload)) {
    return payload.map((item) => item?.fields || item).filter(Boolean);
  }

  return [];
}

function getHeader(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find(
    (header) => header.toLowerCase() === name.toLowerCase()
  );
  return key ? headers[key] : "";
}

function verifyWebhookSecret(headers) {
  if (!AIRTABLE_WEBHOOK_SECRET) return true;

  const direct = getHeader(headers, "x-airtable-webhook-secret");
  const fallback = getHeader(headers, "x-webhook-secret");
  const auth = getHeader(headers, "authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : "";

  return (
    direct === AIRTABLE_WEBHOOK_SECRET ||
    fallback === AIRTABLE_WEBHOOK_SECRET ||
    token === AIRTABLE_WEBHOOK_SECRET
  );
}

async function resolveCompanyMatch(fields) {
  if (fields?.[HUBSPOT_COMPANY_ID_FIELD] !== undefined) {
    const idValue = fieldValueToString(fields[HUBSPOT_COMPANY_ID_FIELD]);
    if (idValue) {
      const companyName = await getHubSpotCompanyNameById(idValue);
      return {
        companyId: idValue,
        companyName,
        sourceField: HUBSPOT_COMPANY_ID_FIELD,
        sourceValue: idValue,
      };
    }
  }

  for (const nameField of HUBSPOT_COMPANY_NAME_FIELDS) {
    if (fields?.[nameField] === undefined) continue;
    const nameValue = fieldValueToString(fields[nameField]);
    if (!nameValue) continue;
    const result = await findHubSpotCompanyByNameExact(nameValue);
    if (result?.id) {
      return {
        companyId: result.id,
        companyName: result?.properties?.name || "",
        sourceField: nameField,
        sourceValue: nameValue,
      };
    }
  }

  return null;
}

export async function handleAirtableWebhook(payload, headers = {}) {
  if (!verifyWebhookSecret(headers)) {
    const err = new Error("Unauthorized Airtable webhook.");
    err.statusCode = 401;
    throw err;
  }

  const fieldSets = extractFieldSets(payload);
  if (!fieldSets.length) {
    return { handled: false, reason: "no_records" };
  }

  const closeOutField = CLOSE_OUT_FIELD;
  const inactiveValue = normalizeText(CLOSE_OUT_INACTIVE_VALUE);
  const lifecycleStageValue = await resolveHubSpotLifecycleStageValue(
    LIFECYCLE_STAGE_LABEL,
    LIFECYCLE_STAGE_FALLBACK
  );

  if (!lifecycleStageValue) {
    console.error("❌ Airtable webhook: lifecycle stage value not resolved.");
    return { handled: false, reason: "lifecycle_stage_missing" };
  }
  let updated = 0;
  const updates = [];

  for (const fields of fieldSets) {
    const closeOutValue = fieldValueToString(fields?.[closeOutField]);
    if (normalizeText(closeOutValue) !== inactiveValue) {
      continue;
    }

    const match = await resolveCompanyMatch(fields);
    if (!match?.companyId) {
      console.error("❌ Airtable webhook: missing HubSpot company match.");
      continue;
    }

    const matchedName = match.companyName || "";

    await updateHubSpotLifecycleStage(match.companyId, lifecycleStageValue);
    console.log(
      `✅ HubSpot lifecycle updated: ${match.companyId} -> ${lifecycleStageValue} ` +
        `(${matchedName || "name unavailable"}; from ${match.sourceField}: ${
          match.sourceValue
        })`
    );
    updates.push({
      companyId: match.companyId,
      lifecycleStage: lifecycleStageValue,
      companyName: matchedName || "",
      sourceField: match.sourceField,
      sourceValue: match.sourceValue,
    });
    updated += 1;
  }

  return { handled: updated > 0, updated, updates };
}
