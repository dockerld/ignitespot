import axios from "axios";
import { HUBSPOT_TOKEN } from "../env.js";
import { normalizeText, tokenize } from "../search-utils.js";

const companyCache = {
  loading: false,
  loaded: false,
  lastLoadedAt: 0,
  results: [],
};

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

export function formatHubSpotOption(company) {
  const name = company.properties?.name || "Unnamed company";
  const domain = company.properties?.domain ? ` • ${company.properties.domain}` : "";
  return {
    text: { type: "plain_text", text: `${name}${domain}`.slice(0, 75) },
    value: company.id,
  };
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
