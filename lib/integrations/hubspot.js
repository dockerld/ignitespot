import axios from "axios";
import {
  HUBSPOT_DEAL_TYPE_PROPERTY,
  HUBSPOT_HEAR_ABOUT_US_PROPERTY,
  HUBSPOT_TOKEN,
} from "../env.js";
import { normalizeText, tokenize } from "../search-utils.js";

const companyCache = {
  loading: false,
  loaded: false,
  lastLoadedAt: 0,
  results: [],
};

const dealTypeCache = {
  loading: false,
  loaded: false,
  lastLoadedAt: 0,
  options: [],
  propertyName: null,
  propertyNameLoadedAt: 0,
};

const hearAboutUsCache = {
  loading: false,
  loaded: false,
  lastLoadedAt: 0,
  options: [],
  propertyName: null,
  propertyNameLoadedAt: 0,
};

const lifecycleStageCache = {
  loading: false,
  loaded: false,
  lastLoadedAt: 0,
  options: [],
};

const DEAL_TYPE_CACHE_TTL_MS = 15 * 60 * 1000;

function scoreCompanyMatch(company, query) {
  const name = normalizeText(company.properties?.name);
  const domain = normalizeText(company.properties?.domain);
  const q = normalizeText(query);
  if (!q) return 0;

  const qTokens = tokenize(q);
  const nameTokens = tokenize(name);
  let score = 0;

  if (name === q) score += 100;
  if (name.startsWith(q)) score += 90;
  if (nameTokens.some((t) => t.startsWith(q))) score += 80;
  if (name.includes(q)) score += 70;
  if (domain.startsWith(q)) score += 60;
  if (domain.includes(q)) score += 50;

  if (qTokens.length > 1) {
    const matched = qTokens.filter(
      (t) => name.includes(t) || domain.includes(t)
    ).length;
    score += matched * 10;
  }

  if (name.length) {
    score += Math.max(0, 20 - name.length / 5);
  }

  return score;
}

function mergeAndRankCompanies(primary, secondary, query, limit = 50) {
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
    .map((company) => ({
      company,
      score: scoreCompanyMatch(company, query),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aName = normalizeText(a.company.properties?.name);
      const bName = normalizeText(b.company.properties?.name);
      return aName.localeCompare(bName);
    })
    .slice(0, limit)
    .map((entry) => entry.company);
}

function findQueryMatchesFromCache(query) {
  if (!companyCache.results.length) return [];
  const q = normalizeText(query);
  const matches = [];

  for (const r of companyCache.results) {
    const name = normalizeText(r.properties?.name);
    const domain = normalizeText(r.properties?.domain);
    const isMatch =
      name.startsWith(q) ||
      domain.startsWith(q) ||
      name.includes(q) ||
      domain.includes(q);

    if (isMatch) {
      matches.push(r);
    }
  }

  return matches;
}

async function postSearch(q) {
  const resp = await axios.post(
    "https://api.hubapi.com/crm/v3/objects/companies/search",
    {
      filterGroups: [
        { filters: [{ propertyName: "name", operator: "CONTAINS_TOKEN", value: q }] },
        { filters: [{ propertyName: "domain", operator: "CONTAINS_TOKEN", value: q }] },
      ],
      properties: ["name", "domain"],
      limit: 50,
    },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 1500,
    }
  );

  if (q.toLowerCase() === "pin") {
    console.log("🧾 HubSpot raw search response:", JSON.stringify(resp.data, null, 2));
  }

  return resp.data?.results || [];
}

async function searchCompanyByNameExact(name) {
  const resp = await axios.post(
    "https://api.hubapi.com/crm/v3/objects/companies/search",
    {
      filterGroups: [
        { filters: [{ propertyName: "name", operator: "EQ", value: name }] },
      ],
      properties: ["name", "domain"],
      limit: 2,
    },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 1500,
    }
  );

  return resp.data?.results || [];
}

async function listCompaniesForQuery(
  query,
  minMatches = 7,
  pageSize = 100,
  maxMillis = 1200
) {
  const q = normalizeText(query);
  const matches = [];
  let after;
  const deadline = Date.now() + maxMillis;

  while (Date.now() < deadline) {
    const resp = await axios.get("https://api.hubapi.com/crm/v3/objects/companies", {
      params: {
        limit: pageSize,
        after,
        properties: "name,domain",
      },
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 900,
    });

    const results = resp.data?.results || [];
    for (const r of results) {
      const name = normalizeText(r.properties?.name);
      const domain = normalizeText(r.properties?.domain);
      const isMatch =
        name.startsWith(q) ||
        domain.startsWith(q) ||
        name.includes(q) ||
        domain.includes(q);

      if (isMatch) {
        matches.push(r);
      }
    }

    if (matches.length >= minMatches) break;

    after = resp.data?.paging?.next?.after;
    if (!after) break;
  }

  if (Date.now() >= deadline) {
    console.log("⏱️ Company fallback hit time budget; returning partial matches.");
  }

  return matches;
}

export async function warmCompanyCache(maxPages = 50, pageSize = 100) {
  if (companyCache.loading) return;
  if (!HUBSPOT_TOKEN) return;

  companyCache.loading = true;
  companyCache.loaded = false;
  companyCache.results = [];

  try {
    let after;
    for (let page = 0; page < maxPages; page += 1) {
      const resp = await axios.get("https://api.hubapi.com/crm/v3/objects/companies", {
        params: {
          limit: pageSize,
          after,
          properties: "name,domain",
        },
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      });

      const results = resp.data?.results || [];
      companyCache.results.push(...results);

      after = resp.data?.paging?.next?.after;
      if (!after) break;
    }

    companyCache.loaded = true;
    companyCache.lastLoadedAt = Date.now();
    console.log(`📦 Company cache warmed: ${companyCache.results.length} companies`);
  } catch (err) {
    console.error(
      "❌ Company cache warm error:",
      err?.response?.status,
      err?.response?.data || err
    );
  } finally {
    companyCache.loading = false;
  }
}

export async function searchHubSpotCompanies(rawQuery) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 3) return [];
  if (!HUBSPOT_TOKEN) {
    console.error("❌ HubSpot search error: missing HUBSPOT_PRIVATE_APP_TOKEN");
    return [];
  }

  let results = await postSearch(query);

  if (!results.length && query.includes(" ")) {
    results = await postSearch(query.split(" ")[0]);
  }

  if (!companyCache.loading && !companyCache.loaded) {
    warmCompanyCache();
  }

  const cached = companyCache.loaded ? findQueryMatchesFromCache(query) : [];
  let fallback = [];
  if (!results.length && !cached.length) {
    fallback = await listCompaniesForQuery(query);
  }

  const combined = mergeAndRankCompanies(results, cached.concat(fallback), query, 50);

  console.log(
    "✅ HubSpot results:",
    results.length,
    "| cache:",
    cached.length,
    "| fallback:",
    fallback.length,
    "| combined:",
    combined.length
  );

  return combined;
}

export async function findHubSpotCompanyByNameExact(rawName) {
  const name = rawName.trim();
  if (!name) return null;
  if (!HUBSPOT_TOKEN) {
    console.error("❌ HubSpot search error: missing HUBSPOT_PRIVATE_APP_TOKEN");
    return null;
  }

  const results = await searchCompanyByNameExact(name);
  return results[0] || null;
}

export function formatHubSpotOption(company) {
  const name = company.properties?.name || "Unnamed company";
  const domain = company.properties?.domain ? ` • ${company.properties.domain}` : "";
  return {
    text: { type: "plain_text", text: `${name}${domain}`.slice(0, 75) },
    value: company.id,
  };
}

function formatHubSpotDealTypeOption(option) {
  const label = option?.label || option?.value || "Unknown";
  const value = option?.value || label;
  return {
    text: { type: "plain_text", text: label.slice(0, 75) },
    value: value.slice(0, 75),
  };
}

function normalizeHubSpotLabel(value) {
  return (value || "").trim().toLowerCase();
}

async function fetchHubSpotDealProperties() {
  const resp = await axios.get("https://api.hubapi.com/crm/v3/properties/deals", {
    headers: {
      Authorization: `Bearer ${HUBSPOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    timeout: 1500,
  });

  return resp.data?.results || [];
}

async function fetchHubSpotLifecycleStageOptions() {
  const resp = await axios.get(
    "https://api.hubapi.com/crm/v3/properties/companies/lifecyclestage",
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 1500,
    }
  );

  return resp.data?.options || [];
}

async function getHubSpotLifecycleStageOptions() {
  if (!HUBSPOT_TOKEN) return [];

  const now = Date.now();
  if (
    lifecycleStageCache.loaded &&
    lifecycleStageCache.options.length &&
    now - lifecycleStageCache.lastLoadedAt < DEAL_TYPE_CACHE_TTL_MS
  ) {
    return lifecycleStageCache.options;
  }

  if (lifecycleStageCache.loading) {
    return lifecycleStageCache.options;
  }

  lifecycleStageCache.loading = true;
  try {
    const options = await fetchHubSpotLifecycleStageOptions();
    lifecycleStageCache.options = options;
    lifecycleStageCache.loaded = true;
    lifecycleStageCache.lastLoadedAt = now;
  } catch (err) {
    console.error(
      "❌ HubSpot lifecycle stage load error:",
      err?.response?.status,
      err?.response?.data || err
    );
  } finally {
    lifecycleStageCache.loading = false;
  }

  return lifecycleStageCache.options;
}

function pickDealTypePropertyName(properties) {
  if (!properties.length) return null;

  const exactLabel = properties.find(
    (property) => normalizeHubSpotLabel(property.label) === "deal type"
  );
  if (exactLabel?.name) return exactLabel.name;

  const nameMatch = properties.find((property) => {
    const name = normalizeHubSpotLabel(property.name);
    return name === "dealtype" || name === "deal_type";
  });
  if (nameMatch?.name) return nameMatch.name;

  const labelContains = properties.find((property) =>
    normalizeHubSpotLabel(property.label).includes("deal type")
  );
  if (labelContains?.name) return labelContains.name;

  const optionField = properties.find(
    (property) =>
      normalizeHubSpotLabel(property.fieldType) === "select" &&
      Array.isArray(property.options) &&
      property.options.length
  );
  return optionField?.name || null;
}

function pickHearAboutUsPropertyName(properties) {
  if (!properties.length) return null;

  const exactLabel = properties.find((property) =>
    normalizeHubSpotLabel(property.label).includes("how did you hear")
  );
  if (exactLabel?.name) return exactLabel.name;

  const labelContains = properties.find((property) =>
    normalizeHubSpotLabel(property.label).includes("hear about")
  );
  if (labelContains?.name) return labelContains.name;

  const nameMatch = properties.find((property) => {
    const name = normalizeHubSpotLabel(property.name);
    return name.includes("hear") && name.includes("about");
  });
  return nameMatch?.name || null;
}

async function resolveHubSpotDealTypePropertyName({ ignoreOverride = false } = {}) {
  const override = (HUBSPOT_DEAL_TYPE_PROPERTY || "").trim();
  if (!ignoreOverride && override) {
    return override;
  }

  const now = Date.now();
  if (
    dealTypeCache.propertyName &&
    now - dealTypeCache.propertyNameLoadedAt < DEAL_TYPE_CACHE_TTL_MS
  ) {
    return dealTypeCache.propertyName;
  }

  const properties = await fetchHubSpotDealProperties();
  const resolved = pickDealTypePropertyName(properties);
  if (resolved) {
    dealTypeCache.propertyName = resolved;
    dealTypeCache.propertyNameLoadedAt = now;
    console.log(`✅ HubSpot deal type property: ${resolved}`);
  }

  return resolved;
}

async function fetchDealPropertyOptions(propertyName) {
  const resp = await axios.get(
    `https://api.hubapi.com/crm/v3/properties/deals/${propertyName}`,
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 1500,
    }
  );

  const options = resp.data?.options || [];
  return options
    .filter((option) => !option.hidden)
    .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
}

async function fetchHubSpotDealTypeOptions() {
  let propertyName = await resolveHubSpotDealTypePropertyName();
  if (!propertyName) return [];

  try {
    const options = await fetchDealPropertyOptions(propertyName);
    dealTypeCache.propertyName = propertyName;
    dealTypeCache.propertyNameLoadedAt = Date.now();
    return options;
  } catch (err) {
    const override = (HUBSPOT_DEAL_TYPE_PROPERTY || "").trim();
    if (override) {
      const fallback = await resolveHubSpotDealTypePropertyName({
        ignoreOverride: true,
      });
      if (fallback && fallback !== propertyName) {
        const options = await fetchDealPropertyOptions(fallback);
        dealTypeCache.propertyName = fallback;
        dealTypeCache.propertyNameLoadedAt = Date.now();
        return options;
      }
    }
    throw err;
  }
}

async function resolveHubSpotHearAboutUsPropertyName({ ignoreOverride = false } = {}) {
  const override = (HUBSPOT_HEAR_ABOUT_US_PROPERTY || "").trim();
  if (!ignoreOverride && override) {
    return override;
  }

  const now = Date.now();
  if (
    hearAboutUsCache.propertyName &&
    now - hearAboutUsCache.propertyNameLoadedAt < DEAL_TYPE_CACHE_TTL_MS
  ) {
    return hearAboutUsCache.propertyName;
  }

  const properties = await fetchHubSpotDealProperties();
  const resolved = pickHearAboutUsPropertyName(properties);
  if (resolved) {
    hearAboutUsCache.propertyName = resolved;
    hearAboutUsCache.propertyNameLoadedAt = now;
    console.log(`✅ HubSpot hear-about-us property: ${resolved}`);
  } else {
    console.error("❌ HubSpot hear-about-us property not found.");
  }

  return resolved;
}

async function fetchHubSpotHearAboutUsOptions() {
  let propertyName = await resolveHubSpotHearAboutUsPropertyName();
  if (!propertyName) return [];

  try {
    const options = await fetchDealPropertyOptions(propertyName);
    hearAboutUsCache.propertyName = propertyName;
    hearAboutUsCache.propertyNameLoadedAt = Date.now();
    return options;
  } catch (err) {
    const override = (HUBSPOT_HEAR_ABOUT_US_PROPERTY || "").trim();
    if (override) {
      const fallback = await resolveHubSpotHearAboutUsPropertyName({
        ignoreOverride: true,
      });
      if (fallback && fallback !== propertyName) {
        const options = await fetchDealPropertyOptions(fallback);
        hearAboutUsCache.propertyName = fallback;
        hearAboutUsCache.propertyNameLoadedAt = Date.now();
        return options;
      }
    }
    throw err;
  }
}

async function getHubSpotDealTypeOptions() {
  if (!HUBSPOT_TOKEN) return [];

  const now = Date.now();
  if (
    dealTypeCache.loaded &&
    dealTypeCache.options.length &&
    now - dealTypeCache.lastLoadedAt < DEAL_TYPE_CACHE_TTL_MS
  ) {
    return dealTypeCache.options;
  }

  if (dealTypeCache.loading) {
    return dealTypeCache.options;
  }

  dealTypeCache.loading = true;
  try {
    const options = await fetchHubSpotDealTypeOptions();
    dealTypeCache.options = options;
    dealTypeCache.loaded = true;
    dealTypeCache.lastLoadedAt = now;
  } catch (err) {
    console.error(
      "❌ HubSpot deal type load error:",
      err?.response?.status,
      err?.response?.data || err
    );
  } finally {
    dealTypeCache.loading = false;
  }

  return dealTypeCache.options;
}

async function getHubSpotHearAboutUsOptions() {
  if (!HUBSPOT_TOKEN) return [];

  const now = Date.now();
  if (
    hearAboutUsCache.loaded &&
    hearAboutUsCache.options.length &&
    now - hearAboutUsCache.lastLoadedAt < DEAL_TYPE_CACHE_TTL_MS
  ) {
    return hearAboutUsCache.options;
  }

  if (hearAboutUsCache.loading) {
    return hearAboutUsCache.options;
  }

  hearAboutUsCache.loading = true;
  try {
    const options = await fetchHubSpotHearAboutUsOptions();
    hearAboutUsCache.options = options;
    hearAboutUsCache.loaded = true;
    hearAboutUsCache.lastLoadedAt = now;
  } catch (err) {
    console.error(
      "❌ HubSpot hear-about-us load error:",
      err?.response?.status,
      err?.response?.data || err
    );
  } finally {
    hearAboutUsCache.loading = false;
  }

  return hearAboutUsCache.options;
}

export async function searchHubSpotDealTypes(rawQuery) {
  if (!HUBSPOT_TOKEN) {
    console.error("❌ HubSpot deal type error: missing HUBSPOT_PRIVATE_APP_TOKEN");
    return [];
  }

  const query = (rawQuery || "").trim().toLowerCase();
  const options = await getHubSpotDealTypeOptions();
  const filtered = query
    ? options.filter((option) => {
        const label = (option.label || "").toLowerCase();
        const value = (option.value || "").toLowerCase();
        return label.includes(query) || value.includes(query);
      })
    : options;

  return filtered.slice(0, 100).map((option) => formatHubSpotDealTypeOption(option));
}

export async function searchHubSpotHearAboutUsOptions(rawQuery) {
  if (!HUBSPOT_TOKEN) {
    console.error(
      "❌ HubSpot hear-about-us error: missing HUBSPOT_PRIVATE_APP_TOKEN"
    );
    return [];
  }

  const query = (rawQuery || "").trim().toLowerCase();
  const options = await getHubSpotHearAboutUsOptions();
  const filtered = query
    ? options.filter((option) => {
        const label = (option.label || "").toLowerCase();
        const value = (option.value || "").toLowerCase();
        return label.includes(query) || value.includes(query);
      })
    : options;

  return filtered.slice(0, 100).map((option) => formatHubSpotDealTypeOption(option));
}

export async function resolveHubSpotLifecycleStageValue(
  label,
  fallbackValue = ""
) {
  if (!label) return fallbackValue;
  const options = await getHubSpotLifecycleStageOptions();
  const normalized = normalizeHubSpotLabel(label);
  const match = options.find(
    (option) => normalizeHubSpotLabel(option.label) === normalized
  );
  if (match?.value) return match.value;

  const valueMatch = options.find(
    (option) => normalizeHubSpotLabel(option.value) === normalized
  );
  if (valueMatch?.value) return valueMatch.value;

  return fallbackValue;
}

export async function updateHubSpotIndustry(companyId) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }

  await axios.patch(
    `https://api.hubapi.com/crm/v3/objects/companies/${companyId}`,
    { properties: { industry: "ACCOUNTING" } },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );
}

export async function updateHubSpotLifecycleStage(companyId, stageValue) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!stageValue) {
    throw new Error("Lifecycle stage value missing.");
  }

  await axios.patch(
    `https://api.hubapi.com/crm/v3/objects/companies/${companyId}`,
    { properties: { lifecyclestage: stageValue } },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );
}

export async function getHubSpotCompanyNameById(companyId) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!companyId) return "";

  const resp = await axios.get(
    `https://api.hubapi.com/crm/v3/objects/companies/${companyId}`,
    {
      params: { properties: "name" },
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data?.properties?.name || "";
}

const associationLabelCache = new Map();

function normalizeAssociationKey(fromType, toType) {
  return `${fromType}:${toType}`.toLowerCase();
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function resolveDealTypeOptionValue(options, label) {
  const normalized = normalizeHubSpotLabel(label);
  if (!normalized) return "";
  const match = options.find(
    (option) => normalizeHubSpotLabel(option.label) === normalized
  );
  if (match?.value) return match.value;
  const valueMatch = options.find(
    (option) => normalizeHubSpotLabel(option.value) === normalized
  );
  return valueMatch?.value || "";
}

function resolveOptionValue(options, label) {
  if (!options || !options.length) return label || "";
  return resolveDealTypeOptionValue(options, label);
}

async function getAssociationLabels(fromType, toType) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }

  const cacheKey = normalizeAssociationKey(fromType, toType);
  if (associationLabelCache.has(cacheKey)) {
    return associationLabelCache.get(cacheKey);
  }

  const resp = await axios.get(
    `https://api.hubapi.com/crm/v4/associations/${fromType}/${toType}/labels`,
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  const labels = resp.data?.results || [];
  associationLabelCache.set(cacheKey, labels);
  return labels;
}

async function getCompanyDealAssociations(companyId, limit = 100) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!companyId) return [];

  const resp = await axios.get(
    `https://api.hubapi.com/crm/v4/objects/companies/${companyId}/associations/deals`,
    {
      params: { limit },
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data?.results || [];
}

async function getDealsByIds(ids, properties = []) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
  if (!uniqueIds.length) return [];

  const chunks = chunkArray(uniqueIds, 100);
  const results = [];

  for (const chunk of chunks) {
    const resp = await axios.post(
      "https://api.hubapi.com/crm/v3/objects/deals/batch/read",
      {
        inputs: chunk.map((id) => ({ id })),
        properties,
      },
      {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      }
    );
    results.push(...(resp.data?.results || []));
  }

  return results;
}

function pickMostRecentDeal(deals) {
  if (!deals.length) return null;
  const ranked = deals
    .map((deal) => {
      const props = deal?.properties || {};
      const modified = Date.parse(props.hs_lastmodifieddate || "") || 0;
      const created = Date.parse(props.createdate || "") || 0;
      return { deal, score: modified || created };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.deal || null;
}

export async function updateHubSpotDealType(dealId, label) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!dealId) {
    return { updated: false, reason: "missing_deal_id" };
  }

  const propertyName = await resolveHubSpotDealTypePropertyName();
  if (!propertyName) {
    return { updated: false, reason: "deal_type_property_missing" };
  }

  const options = await getHubSpotDealTypeOptions();
  const resolvedValue = resolveOptionValue(options, label) || label;

  await axios.patch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
    { properties: { [propertyName]: resolvedValue } },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return { updated: true, dealId, propertyName, value: resolvedValue };
}

export async function updateHubSpotDealHearAboutUs(dealId, label) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!dealId) {
    return { updated: false, reason: "missing_deal_id" };
  }
  const propertyName = await resolveHubSpotHearAboutUsPropertyName();
  if (!propertyName) {
    return { updated: false, reason: "hear_about_us_property_missing" };
  }
  const options = await getHubSpotHearAboutUsOptions();
  const resolvedValue = resolveOptionValue(options, label) || label;

  await axios.patch(
    `https://api.hubapi.com/crm/v3/objects/deals/${dealId}`,
    { properties: { [propertyName]: resolvedValue } },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return { updated: true, dealId, propertyName, value: resolvedValue };
}

export async function updateHubSpotDealTypeForCompany(companyId, label) {
  if (!companyId) {
    return { updated: false, reason: "missing_company_id" };
  }

  const associations = await getCompanyDealAssociations(companyId);
  const dealIds = associations
    .map((entry) => entry?.toObjectId || entry?.id)
    .filter(Boolean);
  if (!dealIds.length) {
    return { updated: false, reason: "no_associated_deals" };
  }

  const deals = await getDealsByIds(dealIds, [
    "dealname",
    "hs_lastmodifieddate",
    "createdate",
  ]);
  const selected = pickMostRecentDeal(deals) || { id: dealIds[0] };
  if (!selected?.id) {
    return { updated: false, reason: "no_deal_selected" };
  }

  const result = await updateHubSpotDealType(selected.id, label);
  return {
    ...result,
    dealName: selected?.properties?.dealname || "",
    selectedFrom: dealIds.length,
  };
}

async function getDealContactAssociations(dealId, limit = 20) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!dealId) return [];

  const resp = await axios.get(
    `https://api.hubapi.com/crm/v4/objects/deals/${dealId}/associations/contacts`,
    {
      params: { limit },
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data?.results || [];
}

function pickPrimaryAssociation(results, primaryTypeIds) {
  if (!results.length) return null;
  if (primaryTypeIds && primaryTypeIds.size) {
    const match = results.find((association) =>
      (association.associationTypes || []).some((type) =>
        primaryTypeIds.has(type.typeId)
      )
    );
    if (match) return match.toObjectId;
  }
  return results[0]?.toObjectId || null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveAssociationTypeId(fromType, toType, preferredLabel) {
  const labels = await getAssociationLabels(fromType, toType);
  if (!labels.length) return null;
  const hubspotDefined = labels.filter(
    (label) => String(label.category || "").toLowerCase() === "hubspot_defined"
  );
  const candidates = hubspotDefined.length ? hubspotDefined : labels;
  if (preferredLabel) {
    const match = candidates.find((label) =>
      new RegExp(preferredLabel, "i").test(label.label || "")
    );
    if (match?.typeId) {
      return { typeId: match.typeId, label: match.label || "", category: match.category || "" };
    }
  }
  const fallback = candidates[0];
  if (!fallback?.typeId) return null;
  return {
    typeId: fallback.typeId,
    label: fallback.label || "",
    category: fallback.category || "",
  };
}

async function associateHubSpotObjects(
  fromType,
  fromId,
  toType,
  toId,
  associationInfo
) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  const typeId =
    typeof associationInfo === "number"
      ? associationInfo
      : associationInfo?.typeId;
  const label =
    typeof associationInfo === "object" && associationInfo
      ? associationInfo.label || ""
      : "";
  const category =
    typeof associationInfo === "object" && associationInfo
      ? associationInfo.category || "HUBSPOT_DEFINED"
      : "HUBSPOT_DEFINED";
  if (!fromId || !toId || !typeId) {
    return { associated: false, reason: "missing_association_data" };
  }

  const url = `https://api.hubapi.com/crm/v4/objects/${fromType}/${fromId}/associations/${toType}/${toId}`;
  const headers = {
    Authorization: `Bearer ${HUBSPOT_TOKEN}`,
    "Content-Type": "application/json",
  };
  const retryStatuses = new Set([404, 429, 500, 502, 503]);
  const body =
    typeId && category
      ? [{ associationCategory: category, associationTypeId: typeId }]
      : [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }].filter(
          (entry) => entry.associationTypeId
        );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await axios.put(url, body, { headers, timeout: 8000 });
      console.log("✅ HubSpot association created:", {
        fromType,
        fromId,
        toType,
        toId,
        typeId,
        label,
        category,
        attempt,
      });
    return { associated: true, typeId, label };
  } catch (err) {
      const status = err?.response?.status;
      const data = err?.response?.data;
      console.error("❌ HubSpot association error:", {
        fromType,
        fromId,
        toType,
        toId,
        typeId,
      label,
      category,
      status,
        attempt,
        data: data || err?.message || err,
      });
      if (!retryStatuses.has(status) || attempt === 3) {
        return { associated: false, reason: "error", status, label, typeId };
      }
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }

  return { associated: false, reason: "error", status: 0, label, typeId };
}

async function waitForHubSpotObject(objectType, objectId, maxAttempts = 5) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!objectType || !objectId) return false;

  const url = `https://api.hubapi.com/crm/v3/objects/${objectType}/${objectId}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await axios.get(url, {
        headers: {
          Authorization: `Bearer ${HUBSPOT_TOKEN}`,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      });
      return true;
    } catch (err) {
      const status = err?.response?.status;
      if (status !== 404 || attempt === maxAttempts) {
        console.error("❌ HubSpot object availability error:", {
          objectType,
          objectId,
          status,
          attempt,
          data: err?.response?.data || err?.message || err,
        });
        return false;
      }
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }
  return false;
}

export async function createHubSpotCompany({ name }) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!name) {
    throw new Error("Company name is required.");
  }

  const resp = await axios.post(
    "https://api.hubapi.com/crm/v3/objects/companies",
    { properties: { name } },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data || null;
}

export async function createHubSpotContact({ firstname, lastname, email }) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!email) {
    throw new Error("Contact email is required.");
  }

  const properties = { email };
  if (firstname) properties.firstname = firstname;
  if (lastname) properties.lastname = lastname;

  const resp = await axios.post(
    "https://api.hubapi.com/crm/v3/objects/contacts",
    { properties },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data || null;
}

export async function createHubSpotDeal({ dealname }) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!dealname) {
    throw new Error("Deal name is required.");
  }

  const resp = await axios.post(
    "https://api.hubapi.com/crm/v3/objects/deals",
    { properties: { dealname } },
    {
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data || null;
}

export async function associateDealToCompany(dealId, companyId) {
  const info = await resolveAssociationTypeId("deals", "companies");
  return associateHubSpotObjects("deals", dealId, "companies", companyId, info);
}

export async function associateDealToContact(dealId, contactId) {
  const info = await resolveAssociationTypeId(
    "deals",
    "contacts",
    "primary"
  );
  return associateHubSpotObjects("deals", dealId, "contacts", contactId, info);
}

export async function associateContactToCompany(contactId, companyId) {
  const info = await resolveAssociationTypeId("contacts", "companies");
  return associateHubSpotObjects(
    "contacts",
    contactId,
    "companies",
    companyId,
    info
  );
}

export async function ensureHubSpotObjectsReady({ companyId, contactId, dealId }) {
  const tasks = [];
  if (companyId) tasks.push(waitForHubSpotObject("companies", companyId));
  if (contactId) tasks.push(waitForHubSpotObject("contacts", contactId));
  if (dealId) tasks.push(waitForHubSpotObject("deals", dealId));
  const results = await Promise.all(tasks);
  return results.every(Boolean);
}

export async function getHubSpotPrimaryContactIdForDeal(dealId) {
  if (!dealId) return null;

  let primaryTypeIds = new Set();
  try {
    const labels = await getAssociationLabels("deals", "contacts");
    primaryTypeIds = new Set(
      labels
        .filter((label) => /primary/i.test(label.label || ""))
        .map((label) => label.typeId)
    );
  } catch (err) {
    console.error(
      "❌ HubSpot association labels load error:",
      err?.response?.status,
      err?.response?.data || err
    );
  }

  const associations = await getDealContactAssociations(dealId);
  return pickPrimaryAssociation(associations, primaryTypeIds);
}

export async function getHubSpotCompanyById(companyId, properties = []) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!companyId) return null;

  const resp = await axios.get(
    `https://api.hubapi.com/crm/v3/objects/companies/${companyId}`,
    {
      params: { properties: properties.length ? properties.join(",") : undefined },
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data || null;
}

export async function getHubSpotContactById(contactId, properties = []) {
  if (!HUBSPOT_TOKEN) {
    throw new Error("HubSpot token missing.");
  }
  if (!contactId) return null;

  const resp = await axios.get(
    `https://api.hubapi.com/crm/v3/objects/contacts/${contactId}`,
    {
      params: { properties: properties.length ? properties.join(",") : undefined },
      headers: {
        Authorization: `Bearer ${HUBSPOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return resp.data || null;
}
