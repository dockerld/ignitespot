import axios from "axios";
import {
  AIRTABLE_TOKEN,
  AIRTABLE_BASE_ID,
  AIRTABLE_TABLE_ID,
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

function isAirtableConfigured() {
  return !!(AIRTABLE_TOKEN && AIRTABLE_BASE_ID && AIRTABLE_TABLE_ID);
}

function parseFieldsList(value) {
  return value
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
}

const searchFields = parseFieldsList(AIRTABLE_SEARCH_FIELDS);
const displayField = AIRTABLE_DISPLAY_FIELD || searchFields[0] || "";
const secondaryField = AIRTABLE_SECONDARY_FIELD || searchFields[1] || "";
const requestedFields = Array.from(
  new Set([
    ...searchFields,
    ...(displayField ? [displayField] : []),
    ...(secondaryField ? [secondaryField] : []),
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

function getRecordSearchTexts(record) {
  const fields = record?.fields || {};
  const texts = [];

  for (const field of searchFields) {
    const value = recordFieldToString(fields[field]);
    if (value) texts.push(value);
  }

  return texts;
}

function scoreAirtableMatch(record, query) {
  const q = normalizeText(query);
  if (!q) return 0;

  const texts = getRecordSearchTexts(record).map(normalizeText).filter(Boolean);
  if (!texts.length) return 0;

  const primary = normalizeText(
    recordFieldToString(record?.fields?.[displayField]) || texts[0]
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

function mergeAndRankAirtableRecords(primary, secondary, query, limit = 50) {
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
      score: scoreAirtableMatch(record, query),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aName = normalizeText(
        recordFieldToString(a.record?.fields?.[displayField])
      );
      const bName = normalizeText(
        recordFieldToString(b.record?.fields?.[displayField])
      );
      return aName.localeCompare(bName);
    })
    .slice(0, limit)
    .map((entry) => entry.record);
}

function findAirtableMatchesFromCache(query) {
  if (!airtableCache.results.length) return [];
  const q = normalizeText(query);
  const matches = [];

  for (const record of airtableCache.results) {
    if (scoreAirtableMatch(record, q) > 0) {
      matches.push(record);
    }
  }

  return matches;
}

async function listAirtableRecordsForQuery(
  query,
  minMatches = 7,
  pageSize = 100,
  maxMillis = 1200
) {
  const q = normalizeText(query);
  const matches = [];
  const deadline = Date.now() + maxMillis;
  let offset;

  while (Date.now() < deadline) {
    const resp = await axios.get(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
      {
        params: {
          pageSize,
          offset,
          fields: requestedFields.length ? requestedFields : undefined,
        },
        headers: {
          Authorization: `Bearer ${AIRTABLE_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 900,
      }
    );

    const results = resp.data?.records || [];
    if (!results.length) break;

    for (const record of results) {
      if (scoreAirtableMatch(record, q) > 0) {
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

export async function warmAirtableCache(maxPages = 50, pageSize = 100) {
  if (airtableCache.loading) return;
  if (!isAirtableConfigured()) return;
  if (!searchFields.length) return;

  airtableCache.loading = true;
  airtableCache.loaded = false;
  airtableCache.results = [];

  try {
    let offset;

    for (let page = 0; page < maxPages; page += 1) {
      const resp = await axios.get(
        `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}`,
        {
          params: {
            pageSize,
            offset,
            fields: requestedFields.length ? requestedFields : undefined,
          },
          headers: {
            Authorization: `Bearer ${AIRTABLE_TOKEN}`,
            "Content-Type": "application/json",
          },
          timeout: 8000,
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
    console.error(
      "❌ Airtable cache warm error:",
      err?.response?.status,
      err?.response?.data || err
    );
  } finally {
    airtableCache.loading = false;
  }
}

export async function searchAirtableRecords(rawQuery) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 3) return [];
  if (!isAirtableConfigured()) {
    console.error("❌ Airtable search error: missing AIRTABLE_TOKEN/base/table.");
    return [];
  }
  if (!searchFields.length) {
    console.error("❌ Airtable search error: AIRTABLE_SEARCH_FIELDS is not set.");
    return [];
  }

  if (!airtableCache.loading && !airtableCache.loaded) {
    warmAirtableCache();
  }

  const cached = airtableCache.loaded ? findAirtableMatchesFromCache(query) : [];
  let fallback = [];
  if (!cached.length) {
    fallback = await listAirtableRecordsForQuery(query);
  }

  const combined = mergeAndRankAirtableRecords(cached, fallback, query, 50);

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

export function formatAirtableOption(record) {
  const fields = record?.fields || {};
  const title = recordFieldToString(fields[displayField]) || "Unnamed record";
  const secondary = secondaryField ? recordFieldToString(fields[secondaryField]) : "";
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

export async function updateAirtableRecord(recordId) {
  if (!isAirtableConfigured()) {
    throw new Error("Airtable config missing.");
  }
  if (!AIRTABLE_UPDATE_FIELD) {
    throw new Error("AIRTABLE_UPDATE_FIELD is missing.");
  }

  const updateValue = parseUpdateValue(AIRTABLE_UPDATE_VALUE);
  await axios.patch(
    `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${AIRTABLE_TABLE_ID}/${recordId}`,
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
