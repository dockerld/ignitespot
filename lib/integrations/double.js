import axios from "axios";
import {
  DOUBLE_CLIENT_ID,
  DOUBLE_CLIENT_SECRET,
  DOUBLE_BASE_URL,
} from "../env.js";
import { normalizeText, tokenize } from "../search-utils.js";

const doubleAuth = {
  token: null,
  expiresAt: 0,
  inflight: null,
};

const doubleClientCache = {
  loading: false,
  loaded: false,
  lastLoadedAt: 0,
  results: [],
};

function isDoubleConfigured() {
  return !!(DOUBLE_CLIENT_ID && DOUBLE_CLIENT_SECRET);
}

async function getDoubleAccessToken() {
  const now = Date.now();
  if (doubleAuth.token && now < doubleAuth.expiresAt) return doubleAuth.token;
  if (!isDoubleConfigured()) {
    throw new Error("Double credentials are missing.");
  }
  if (doubleAuth.inflight) return doubleAuth.inflight;

  doubleAuth.inflight = (async () => {
    const body = new URLSearchParams();
    body.set("grant_type", "client_credentials");
    body.set("client_id", DOUBLE_CLIENT_ID);
    body.set("client_secret", DOUBLE_CLIENT_SECRET);

    const resp = await axios.post(`${DOUBLE_BASE_URL}/oauth/token`, body, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      timeout: 1500,
    });

    const token = resp.data?.access_token;
    if (!token) {
      throw new Error("Double access token missing from response.");
    }

    const expiresIn = Number(resp.data?.expires_in);
    const ttlSeconds =
      Number.isFinite(expiresIn) && expiresIn > 60 ? expiresIn - 60 : 23 * 60 * 60;

    doubleAuth.token = token;
    doubleAuth.expiresAt = Date.now() + ttlSeconds * 1000;
    return token;
  })();

  try {
    return await doubleAuth.inflight;
  } finally {
    doubleAuth.inflight = null;
  }
}

function getDoubleSearchTexts(client) {
  const texts = [];
  const push = (value) => {
    if (typeof value === "string" && value.trim()) {
      texts.push(value);
    }
  };

  push(client?.name);
  push(client?.email);
  push(client?.primaryEmail);
  push(client?.contactEmail);
  push(client?.domain);

  const emails = client?.emails || client?.emailAddresses;
  if (Array.isArray(emails)) {
    emails.forEach((email) => push(email));
  }

  const contacts = client?.contacts || client?.contact || client?.primaryContact;
  if (Array.isArray(contacts)) {
    contacts.forEach((contact) => {
      push(contact?.name);
      push(contact?.email);
      push(contact?.primaryEmail);
    });
  } else if (contacts && typeof contacts === "object") {
    push(contacts?.name);
    push(contacts?.email);
    push(contacts?.primaryEmail);
  }

  return texts;
}

function scoreDoubleClientMatch(client, query) {
  const q = normalizeText(query);
  if (!q) return 0;

  const texts = getDoubleSearchTexts(client).map(normalizeText).filter(Boolean);
  if (!texts.length) return 0;

  const name = normalizeText(client?.name);
  const qTokens = tokenize(q);
  const nameTokens = tokenize(name);
  let score = 0;

  if (name === q) score += 100;
  if (name.startsWith(q)) score += 90;
  if (nameTokens.some((t) => t.startsWith(q))) score += 80;
  if (name.includes(q)) score += 70;

  for (const text of texts) {
    if (text === name) continue;
    if (text.startsWith(q)) score = Math.max(score, 60);
    if (text.includes(q)) score = Math.max(score, 50);
  }

  if (qTokens.length > 1) {
    const matched = qTokens.filter((t) =>
      texts.some((text) => text.includes(t))
    ).length;
    score += matched * 10;
  }

  if (name.length) {
    score += Math.max(0, 20 - name.length / 5);
  }

  return score;
}

function mergeAndRankDoubleClients(primary, secondary, query, limit = 50) {
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
    .map((client) => ({
      client,
      score: scoreDoubleClientMatch(client, query),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const aName = normalizeText(a.client?.name || "");
      const bName = normalizeText(b.client?.name || "");
      return aName.localeCompare(bName);
    })
    .slice(0, limit)
    .map((entry) => entry.client);
}

function findDoubleMatchesFromCache(query) {
  if (!doubleClientCache.results.length) return [];
  const q = normalizeText(query);
  const matches = [];

  for (const client of doubleClientCache.results) {
    if (scoreDoubleClientMatch(client, q) > 0) {
      matches.push(client);
    }
  }

  return matches;
}

async function listDoubleClientsForQuery(
  query,
  minMatches = 7,
  pageSize = 100,
  maxMillis = 1200
) {
  const q = normalizeText(query);
  const matches = [];
  const deadline = Date.now() + maxMillis;
  let offset = 0;

  const token = await getDoubleAccessToken();

  while (Date.now() < deadline) {
    const resp = await axios.get(`${DOUBLE_BASE_URL}/api/clients`, {
      params: {
        limit: pageSize,
        offset,
      },
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 900,
    });

    const results = Array.isArray(resp.data) ? resp.data : [];
    if (!results.length) break;

    for (const client of results) {
      if (scoreDoubleClientMatch(client, q) > 0) {
        matches.push(client);
      }
    }

    if (matches.length >= minMatches) break;

    offset += results.length;
    if (results.length < pageSize) break;
  }

  if (Date.now() >= deadline) {
    console.log("⏱️ Double search fallback hit time budget; returning partial matches.");
  }

  return matches;
}

export async function warmDoubleClientCache(maxPages = 50, pageSize = 100) {
  if (doubleClientCache.loading) return;
  if (!isDoubleConfigured()) return;

  doubleClientCache.loading = true;
  doubleClientCache.loaded = false;
  doubleClientCache.results = [];

  try {
    const token = await getDoubleAccessToken();
    let offset = 0;

    for (let page = 0; page < maxPages; page += 1) {
      const resp = await axios.get(`${DOUBLE_BASE_URL}/api/clients`, {
        params: {
          limit: pageSize,
          offset,
        },
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        timeout: 8000,
      });

      const results = Array.isArray(resp.data) ? resp.data : [];
      if (!results.length) break;

      doubleClientCache.results.push(...results);
      offset += results.length;

      if (results.length < pageSize) break;
    }

    doubleClientCache.loaded = true;
    doubleClientCache.lastLoadedAt = Date.now();
    console.log(
      `📦 Double client cache warmed: ${doubleClientCache.results.length} clients`
    );
  } catch (err) {
    console.error(
      "❌ Double client cache warm error:",
      err?.response?.status,
      err?.response?.data || err
    );
  } finally {
    doubleClientCache.loading = false;
  }
}

export async function searchDoubleClients(rawQuery) {
  const query = rawQuery.trim().replace(/\s+/g, " ");
  if (query.length < 3) return [];
  if (!isDoubleConfigured()) {
    console.error("❌ Double search error: missing DOUBLE_CLIENT_ID/DOUBLE_CLIENT_SECRET");
    return [];
  }

  if (!doubleClientCache.loading && !doubleClientCache.loaded) {
    warmDoubleClientCache();
  }

  const cached = doubleClientCache.loaded ? findDoubleMatchesFromCache(query) : [];
  let fallback = [];
  if (!cached.length) {
    fallback = await listDoubleClientsForQuery(query);
  }

  const combined = mergeAndRankDoubleClients(cached, fallback, query, 50);

  console.log(
    "✅ Double results:",
    combined.length,
    "| cache:",
    cached.length,
    "| fallback:",
    fallback.length
  );

  return combined;
}

export function formatDoubleClientOption(client) {
  const name = client?.name || "Unnamed client";
  const email =
    client?.email ||
    client?.primaryEmail ||
    client?.contactEmail ||
    (Array.isArray(client?.emails) ? client.emails[0] : "");
  const suffix = email ? ` • ${email}` : "";

  return {
    text: { type: "plain_text", text: `${name}${suffix}`.slice(0, 75) },
    value: String(client?.id || ""),
  };
}

export async function updateDoubleClientDetails(clientId, details) {
  const token = await getDoubleAccessToken();
  await axios.put(
    `${DOUBLE_BASE_URL}/api/clients/${encodeURIComponent(clientId)}/details`,
    { details },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );
}

export async function applyDoubleTaskTemplateToClients(taskTemplateId, clientIds) {
  const token = await getDoubleAccessToken();
  const ids = (Array.isArray(clientIds) ? clientIds : [])
    .map((id) => Number(id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const templateId = Number(taskTemplateId);

  if (!Number.isFinite(templateId) || templateId <= 0) {
    return { applied: false, reason: "invalid_template_id" };
  }
  if (!ids.length) {
    return { applied: false, reason: "missing_client_ids" };
  }

  await axios.post(
    `${DOUBLE_BASE_URL}/api/task-templates`,
    {
      clientIds: ids,
      taskTemplateId: templateId,
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      timeout: 8000,
    }
  );

  return { applied: true, taskTemplateId: templateId, clientIds: ids };
}

export async function applyDoubleTaskTemplateToClient(taskTemplateId, clientId) {
  return applyDoubleTaskTemplateToClients(taskTemplateId, [clientId]);
}
