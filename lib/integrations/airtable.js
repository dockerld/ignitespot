import axios from "axios";
import {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_CLIENT_NAMES_TABLE_ID,
  AIRTABLE_SEARCH_FIELDS,
  AIRTABLE_DISPLAY_FIELD,
  AIRTABLE_SECONDARY_FIELD,
  AIRTABLE_UPDATE_FIELD,
  AIRTABLE_UPDATE_VALUE,
} from "../env.js";
import { normalizeText, tokenize } from "../search-utils.js";

const airtableCache = {
  loading: false,
  loaded: false,
  lastLoadedAt: 0,
  results: [],
};
const AIRTABLE_SEARCH_TIMEOUT_MS = 1500;
const AIRTABLE_SEARCH_MAX_RETRIES = 1;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function isRetryableAirtableError(err) {
  const status = err?.response?.status;
  const code = err?.code;
  if (status && RETRYABLE_STATUS_CODES.has(status)) return true;
  return (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "EAI_AGAIN"
  );
}

function summarizeAirtableError(err) {
  return {
    status: err?.response?.status || null,
    code: err?.code || null,
    message: err?.message || "Unknown Airtable error",
  };
}

async function getAirtablePage(url, config, retries = AIRTABLE_SEARCH_MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries + 1; attempt += 1) {
    try {
      return await axios.get(url, config);
    } catch (err) {
      const shouldRetry = attempt <= retries && isRetryableAirtableError(err);
      if (!shouldRetry) throw err;
      console.warn("⚠️ Airtable search request retrying:", {
        attempt,
        ...summarizeAirtableError(err),
      });
    }
  }
}

function isAirtableConfigured(tableId = AIRTABLE_CLIENT_NAMES_TABLE_ID) {
  return !!(AIRTABLE_TOKEN && AIRTABLE_BASE_ID && tableId);
}

function parseFieldsList(value) {
  return value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

function resolveSearchConfig(overrides = {}) {
  const hasSearchFields = Object.prototype.hasOwnProperty.call(
    overrides,
    "searchFields"
  );
  const hasDisplayField = Object.prototype.hasOwnProperty.call(
    overrides,
    "displayField"
  );
  const hasSecondaryField = Object.prototype.hasOwnProperty.call(
    overrides,
    "secondaryField"
  );
  const searchFields =
    hasSearchFields && Array.isArray(overrides.searchFields)
      ? overrides.searchFields
      : defaultSearchFields;
  const displayField = hasDisplayField
    ? overrides.displayField
    : defaultDisplayField || searchFields[0] || "";
  const secondaryField = hasSecondaryField
    ? overrides.secondaryField
    : defaultSecondaryField || searchFields[1] || "";
  const requestedFields = Array.from(
    new Set([
      ...searchFields,
      ...(displayField ? [displayField] : []),
      ...(secondaryField ? [secondaryField] : []),
    ])
  );

  return {
    searchFields,
    displayField,
    secondaryField,
    requestedFields,
  };
}

const defaultSearchFields = parseFieldsList(AIRTABLE_SEARCH_FIELDS);
const defaultDisplayField =
  AIRTABLE_DISPLAY_FIELD || defaultSearchFields[0] || "";
const defaultSecondaryField =
  AIRTABLE_SECONDARY_FIELD || defaultSearchFields[1] || "";
const defaultRequestedFields = Array.from(
  new Set([
    ...defaultSearchFields,
    ...(defaultDisplayField ? [defaultDisplayField] : []),
    ...(defaultSecondaryField ? [defaultSecondaryField] : []),
  ])
);

function recordFieldToString(value) {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) {
    return value.map(recordFieldToString).filter(Boolean).join(", ");
  }
  if (typeof value === "object") {
    if (typeof value.name === "string") return value.name;
    if (typeof value.email === "string") return value.email;
    if (typeof value.id === "string" || typeof value.id === "number") {
      return String(value.id);
    }
    try {
      return JSON.stringify(value);
    } catch (err) {
      return "";
    }
  }
  return String(value);
}

function getRecordSearchTexts(record, searchFields) {
  const fields = record?.fields || {};
  const texts = [];

  for (const field of searchFields) {
    const value = recordFieldToString(fields[field]);
    if (value) texts.push(value);
  }

  return texts;
}

function scoreAirtableMatch(record, query, config) {
  const q = normalizeText(query);
  if (!q) return 0;

  const texts = getRecordSearchTexts(record, config.searchFields)
    .map(normalizeText)
    .filter(Boolean);
  if (!texts.length) return 0;

  const primary = normalizeText(
    recordFieldToString(record?.fields?.[config.displayField]) || texts[0]
  );
  const qTokens = tokenize(q);
  const primaryTokens = tokenize(primary);
  let score = 0;

  if (primary === q) score += 100;
  if (primary.startsWith(q)) score += 90;
  if (primaryTokens.some((t) => t.startsWith(q))) score += 80;
  if (primary.includes(q)) score += 70;

  for (const text of texts) {
    if (text === primary) continue;
    if (text.startsWith(q)) score = Math.max(score, 60);
    if (text.includes(q)) score = Math.max(score, 50);
  }

  if (qTokens.length > 1) {
    const matched = qTokens.filter((t) => texts.some((text) => text.includes(t)))
      .length;
    score += matched * 10;
  }

  if (primary.length) {
    score += Math.max(0, 20 - primary.length / 5);
  }

  return score;
}

function mergeAndRankAirtableRecords(
  primary,
  secondary,
  query,
  config,
  limit = 50
) {
  const byId = new Map();

  for (const item of primary) {
    if (!item?.id) continue;
    byId.set(item.id, item);
  }

  for (const item of secondary) {
    if (!item?.id) continue;
    if (!byId.has(item.id)) {
      byId.set(item.id, item);
    }
  }

  return Array.from(byId.values())
    .map((record) => ({
      record,
      score: scoreAirtableMatch(record, query, config),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aName = normalizeText(
        recordFieldToString(a.record?.fields?.[config.displayField])
      );
      const bName = normalizeText(
        recordFieldToString(b.record?.fields?.[config.displayField])
      );
      return aName.localeCompare(bName);
    })
    .slice(0, limit)
    .map((entry) => entry.record);
}

function findAirtableMatchesFromCache(query, config) {
  if (!airtableCache.results.length) return [];
  const q = normalizeText(query);
  const matches = [];

  for (const record of airtableCache.results) {
    if (scoreAirtableMatch(record, q, config) > 0) {
      matches.push(record);
    }
  }

  return matches;
}

async function listAirtableRecordsForQuery(
  query,
  tableId = AIRTABLE_CLIENT_NAMES_TABLE_ID,
  config,
  minMatches = 7,
  pageSize = 100,
  maxMillis = 1200
) {
  const q = normalizeText(query);
  const containsFormula = buildContainsFormula(config.searchFields, q);
  const matches = [];
  const deadline = Date.now() + maxMillis;
  let offset;

  while (Date.now() < deadline) {
    const resp = await getAirtablePage(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`,
      {
        params: {
          pageSize,
          offset,
          filterByFormula: containsFormula || undefined,
          fields: config.requestedFields.length ? config.requestedFields : undefined,
        },
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: AIRTABLE_SEARCH_TIMEOUT_MS,
      }
    );

    const results = resp.data?.records || [];
    if (!results.length) break;

    for (const record of results) {
      if (scoreAirtableMatch(record, q, config) > 0) {
        matches.push(record);
      }
    }

    if (matches.length >= minMatches) break;

    offset = resp.data?.offset;
    if (!offset) break;
  }

  if (Date.now() >= deadline) {
    console.log("⏱️ Airtable search fallback hit time budget; returning partial matches.");
  }

  return matches;
}

export async function warmAirtableCache(
  maxPages = 50,
  pageSize = 100,
  tableId = AIRTABLE_CLIENT_NAMES_TABLE_ID
) {
  if (tableId !== AIRTABLE_CLIENT_NAMES_TABLE_ID) return;
  if (airtableCache.loading) return;
  if (!isAirtableConfigured()) return;
  if (!defaultSearchFields.length) return;

  airtableCache.loading = true;
  airtableCache.loaded = false;
  airtableCache.results = [];

  try {
    let offset;

    for (let page = 0; page < maxPages; page += 1) {
      const resp = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENT_NAMES_TABLE_ID}`,
        {
          params: {
          pageSize,
          offset,
          fields: defaultRequestedFields.length ? defaultRequestedFields : undefined,
        },
          headers: {
            Authorization: `Bearer ${AIRTABLE_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 20000,
        }
      );

      const results = resp.data?.records || [];
      if (!results.length) break;

      airtableCache.results.push(...results);

      offset = resp.data?.offset;
      if (!offset) break;
    }

    airtableCache.loaded = true;
    airtableCache.lastLoadedAt = Date.now();
    console.log(`📦 Airtable cache warmed: ${airtableCache.results.length} records`);
  } catch (err) {
    console.error("❌ Airtable cache warm error:", summarizeAirtableError(err));
  } finally {
    airtableCache.loading = false;
  }
}

export async function searchAirtableRecords(
  rawQuery,
  tableId = AIRTABLE_CLIENT_NAMES_TABLE_ID,
  overrides = {}
) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 3) return [];
  if (!isAirtableConfigured(tableId)) {
    console.error("❌ Airtable search error: missing AIRTABLE_TOKEN/base/table.");
    return [];
  }
  const config = resolveSearchConfig(overrides);
  if (!config.searchFields.length) {
    console.error("❌ Airtable search error: AIRTABLE_SEARCH_FIELDS is not set.");
    return [];
  }

  const useCache =
    tableId === AIRTABLE_CLIENT_NAMES_TABLE_ID &&
    !overrides.searchFields &&
    !overrides.displayField &&
    !overrides.secondaryField;
  if (useCache && !airtableCache.loading && !airtableCache.loaded) {
    warmAirtableCache();
  }

  const cached =
    useCache && airtableCache.loaded ? findAirtableMatchesFromCache(query, config) : [];
  let fallback = [];
  if (!cached.length) {
    fallback = await listAirtableRecordsForQuery(query, tableId, config);
  }

  const combined = mergeAndRankAirtableRecords(cached, fallback, query, config, 50);

  console.log(
    "✅ Airtable results:",
    combined.length,
    "| cache:",
    cached.length,
    "| fallback:",
    fallback.length
  );

  return combined;
}

export function formatAirtableOption(record, overrides = {}) {
  const config = resolveSearchConfig(overrides);
  const fields = record?.fields || {};
  const title =
    recordFieldToString(fields[config.displayField]) || "Unnamed record";
  const secondary = config.secondaryField
    ? recordFieldToString(fields[config.secondaryField])
    : "";
  const suffix = secondary ? ` • ${secondary}` : "";

  return {
    text: { type: "plain_text", text: `${title}${suffix}`.slice(0, 75) },
    value: record.id,
  };
}

function parseUpdateValue(value) {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return value;

  try {
    return JSON.parse(trimmed);
  } catch (err) {
    return value;
  }
}

function buildFilterFormula(fieldName, value) {
  const raw = String(value ?? "");
  const escaped = raw.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const numeric = Number(raw);
  const isNumeric = raw !== "" && Number.isFinite(numeric);
  const stringExpr = `{${fieldName}} = '${escaped}'`;
  const numericExpr = `{${fieldName}} = ${numeric}`;
  return isNumeric ? `OR(${stringExpr}, ${numericExpr})` : stringExpr;
}

function buildContainsFormula(fields, value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw || !fields.length) return "";
  const escaped = raw
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const parts = fields.map(
    (field) => `REGEX_MATCH(LOWER({${field}}), \"${escaped}\")`
  );
  return parts.length === 1 ? parts[0] : `OR(${parts.join(",")})`;
}

export async function findAirtableRecordByField(
  fieldName,
  value,
  tableId = AIRTABLE_CLIENT_NAMES_TABLE_ID
) {
  if (!isAirtableConfigured(tableId)) {
    throw new Error("Airtable config missing.");
  }
  if (!fieldName) {
    throw new Error("Airtable field name is required.");
  }
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const resp = await axios.get(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`,
    {
      params: {
        maxRecords: 1,
        filterByFormula: buildFilterFormula(fieldName, value),
      },
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data?.records?.[0] || null;
}

export async function createAirtableRecord(
  fields,
  tableId = AIRTABLE_CLIENT_NAMES_TABLE_ID
) {
  if (!isAirtableConfigured(tableId)) {
    throw new Error("Airtable config missing.");
  }

  const payload = fields && Object.keys(fields).length ? { fields } : null;
  if (!payload) {
    throw new Error("Airtable create requires at least one field.");
  }

  const resp = await axios.post(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data;
}

export async function updateAirtableRecordFields(
  recordId,
  fields,
  tableId = AIRTABLE_CLIENT_NAMES_TABLE_ID
) {
  if (!isAirtableConfigured(tableId)) {
    throw new Error("Airtable config missing.");
  }
  if (!recordId) {
    throw new Error("Airtable recordId is required.");
  }
  const payload = fields && Object.keys(fields).length ? { fields } : null;
  if (!payload) {
    throw new Error("Airtable update requires at least one field.");
  }

  const resp = await axios.patch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data;
}

export async function updateAirtableRecord(recordId) {
  if (!isAirtableConfigured()) {
    throw new Error("Airtable config missing.");
  }
  if (!AIRTABLE_UPDATE_FIELD) {
    throw new Error("AIRTABLE_UPDATE_FIELD is missing.");
  }

  const updateValue = parseUpdateValue(AIRTABLE_UPDATE_VALUE);
  await axios.patch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_CLIENT_NAMES_TABLE_ID}/${recordId}`,
    {
      fields: {
        [AIRTABLE_UPDATE_FIELD]: updateValue,
      },
    },
    {
      headers: {
        Authorization: `Bearer ${AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );
}
