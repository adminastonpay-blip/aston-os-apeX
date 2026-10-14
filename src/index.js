/**
 * ASTON OS Omni-Matrix Apex — Universal Edge Engine
 * Edition: 7.0.1-omni-core (hardened)
 */
const C = {
  VERSION: "7.0.1-omni-core",
  PLATFORM: "ASTON OS Universal Edge",
  MAX_BODY: 524288,
  SESSION_TTL: 2592000,
  MODEL_DEFAULT: "@cf/meta/llama-3.1-8b-instruct-fp8",
  AI_FALLBACKS: [
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/meta/llama-3.1-8b-instruct-fast",
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/zai-org/glm-4.7-flash",
    "@cf/openai/gpt-oss-20b"
  ],
  MAX_TOKENS: 2048,
  SECTORS: ["primary", "industry", "infra", "fintech", "govtech", "health", "mobility", "media"]
};

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    if (request.method === "OPTIONS") return preflight(request, env);
    try {
      const response = await route(request, env, ctx, requestId);
      return withTelemetryHeaders(response, request, requestId);
    } catch (e) {
      console.error("[ASTON_OMNI_CRITICAL_EXCEPTION]", { requestId, error: safeMessage(e) });
      return withTelemetryHeaders(json({ ok: false, error: "Omni-Core Engine Exception", request_id: requestId }, 500, request, env), request, requestId);
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(executeTelemetrySync(env, { type: "omni_scheduled_global_sync", cron: controller?.cron || null, timestamp: Date.now() })
      .catch((e) => console.error("[ASTON_CRON_FAIL]", safeMessage(e))));
  },
  async queue(batch, env) {
    for (const message of batch.messages) {
      try { await processQueueMessage(message.body, env); message.ack(); }
      catch (e) { console.error("[ASTON_QUEUE_RETRY]", safeMessage(e)); message.retry(); }
    }
  }
};

async function route(req, env, ctx, rid) {
  const p = new URL(req.url).pathname;
  if (p === "/" && req.method === "GET") return json({ ok: true, service: C.PLATFORM, edition: C.VERSION, status: "omni-operational", supported_macrosectors: C.SECTORS }, 200, req, env);
  if (p === "/health" || p === "/health-diagnostic") return healthDiagnostics(req, env);
  if (p.startsWith("/v1/ingest/")) {
    if (req.method !== "POST") return methodNotAllowed(req, env, ["POST"]);
    if (!authorized(req, env)) return unauthorized(req, env);
    return handleUniversalIngest(req, env, ctx, rid, p.split("/")[3]);
  }
  if (["/v1/ai/chat", "/api/chat", "/chat"].includes(p)) {
    if (req.method !== "POST") return methodNotAllowed(req, env, ["POST"]);
    if (env.ASTON_PUBLIC_CHAT !== "true" && !authorized(req, env)) return unauthorized(req, env);
    return handleNeuralChat(req, env, ctx, rid);
  }
  if (p.startsWith("/v1/records")) {
    if (!authorized(req, env)) return unauthorized(req, env);
    const raw = p.split("/")[3] || "general";
    return handleSectorRecords(req, env, ctx, rid, C.SECTORS.includes(raw) ? raw : "general");
  }
  if (p === "/v1/stats") {
    if (req.method !== "GET") return methodNotAllowed(req, env, ["GET"]);
    if (!authorized(req, env)) return unauthorized(req, env);
    return handleTenantStats(req, env, rid);
  }
  if (p === "/v1/ledger") {
    if (req.method !== "POST") return methodNotAllowed(req, env, ["POST"]);
    if (!authorized(req, env)) return unauthorized(req, env);
    return handleLedgerTransaction(req, env, ctx, rid);
  }
  return json({ ok: false, error: "Omni protocol endpoint not found", request_id: rid }, 404, req, env);
}

async function handleTenantStats(req, env, rid) {
  const tenant = (req.headers.get("X-Aston-Tenant") || "global-default").slice(0, 100);
  const db = env.ASTON_DB || env.ASTON_DB_BACKUP;
  if (!db) return json({ ok: false, error: "Records storage unavailable", request_id: rid }, 503, req, env);
  try {
    const total = await db.prepare("SELECT COUNT(*) AS count FROM enterprise_records WHERE tenant_id = ?").bind(tenant).first();
    const bySector = await db.prepare("SELECT sector, COUNT(*) AS count FROM enterprise_records WHERE tenant_id = ? GROUP BY sector ORDER BY sector").bind(tenant).all();
    const recent = await db.prepare("SELECT COUNT(*) AS count FROM enterprise_records WHERE tenant_id = ? AND created_at >= datetime('now', '-24 hours')").bind(tenant).first();
    return json({
      ok: true,
      request_id: rid,
      tenant,
      generated_at: new Date().toISOString(),
      records: { total: Number(total?.count || 0), last_24_hours: Number(recent?.count || 0), by_sector: bySector?.results || [] },
      dependencies: { d1: "available", kv: env.ASTON_KV ? "binding_present" : "not_configured", r2: env.ASTON_R2 ? "binding_present" : "not_configured", queue: env.EVENTS ? "binding_present" : "not_configured", ai: env.AI ? "binding_present" : "not_configured" }
    }, 200, req, env);
  } catch (e) {
    console.error("[STATS_QUERY_FAIL]", { request_id: rid, error: safeMessage(e) });
    return json({ ok: false, error: "Stats query failed", request_id: rid }, 503, req, env);
  }
}

async function handleUniversalIngest(req, env, ctx, rid, sector) {
  const targetSector = C.SECTORS.includes(sector) ? sector : "general";
  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);
  const packetId = typeof parsed.data.packet_id === "string" && parsed.data.packet_id.length <= 100
    ? parsed.data.packet_id.replace(/[^a-zA-Z0-9_-]/g, "") : crypto.randomUUID();
  const payload = parsed.data.payload || parsed.data;
  if (env.EVENTS) ctx.waitUntil(env.EVENTS.send({ type: `omni_ingest_${targetSector}`, packet_id: packetId, sector: targetSector, payload, timestamp: Date.now() })
    .catch((e) => console.error("[INGEST_QUEUE_FAIL]", safeMessage(e))));
  if (env.ASTON_R2) {
    const key = `datalake/${targetSector}/${new Date().toISOString().slice(0, 10)}/${packetId}.json`;
    ctx.waitUntil(env.ASTON_R2.put(key, JSON.stringify({ packet_id: packetId, sector: targetSector, payload, ingested_at: Date.now() }), { httpMetadata: { contentType: "application/json" } })
      .catch((e) => console.error("[INGEST_R2_FAIL]", safeMessage(e))));
  }
  return json({ ok: true, status: "packet_accepted", sector: targetSector, packet_id: packetId, node: req.cf?.colo || "EDGE", request_id: rid }, 202, req, env);
}

async function handleNeuralChat(req, env, ctx, rid) {
  if (!env.AI) return json({ ok: false, error: "Workers AI binding missing" }, 503, req, env);
  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);
  const message = typeof parsed.data.message === "string" ? parsed.data.message.trim() : "";
  if (!message) return json({ ok: false, error: "Field 'message' is required" }, 400, req, env);
  if (message.length > 8000) return json({ ok: false, error: "Message too long" }, 413, req, env);
  const sid = typeof parsed.data.session_id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(parsed.data.session_id) ? parsed.data.session_id : crypto.randomUUID();
  const sessionTenant = (req.headers.get("X-Aston-Tenant") || "global-default").slice(0, 100);
  const sessionKey = sessionStorageKey(sessionTenant, sid);
  const history = await getHistory(env, sessionKey);
  const messages = [
    { role: "system", content: "You are ASTON OS Omni-Core, a global intelligence engine operating on the Edge. Provide precise analytics across sectors: Agritech, Energy, Fintech, GovTech, Health, Mobility and Media." },
    ...history, { role: "user", content: message }
  ];
  let answer = "", modelUsed = "";
  const candidates = [typeof parsed.data.model === "string" ? parsed.data.model : null, env.ASTON_AI_MODEL, C.MODEL_DEFAULT, ...C.AI_FALLBACKS].filter(Boolean).filter((m, i, a) => a.indexOf(m) === i);
  for (const model of candidates) {
    try {
      const res = await env.AI.run(model, { messages, max_tokens: C.MAX_TOKENS });
      answer = extractText(res);
      if (answer) { modelUsed = model; break; }
    } catch (e) { console.warn(`[OMNI_AI_FALLBACK] ${model} failed: ${safeMessage(e)}`); }
  }
  if (!answer) return json({ ok: false, error: "All neural models failed", request_id: rid }, 502, req, env);
  ctx.waitUntil(saveHistory(env, sessionKey, message, answer).catch((e) => console.error("[HISTORY_FAIL]", safeMessage(e))));
  return json({ ok: true, request_id: rid, session_id: sid, answer, model: modelUsed }, 200, req, env);
}

const INSERT_SQL = "INSERT INTO enterprise_records (id, tenant_id, sector, title, payload) VALUES (?, ?, ?, ?, ?)";
async function handleSectorRecords(req, env, ctx, rid, sector) {
  const tenant = (req.headers.get("X-Aston-Tenant") || "global-default").slice(0, 100);
  if (req.method === "GET") {
    const url = new URL(req.url);
    const limit = parseBoundedInt(url.searchParams.get("limit"), 50, 1, 100);
    const offset = parseBoundedInt(url.searchParams.get("offset"), 0, 0, 1000000);
    if (!Number.isInteger(limit) || !Number.isInteger(offset)) {
      return json({ ok: false, error: "limit must be 1-100 and offset must be 0-1000000", request_id: rid }, 400, req, env);
    }
    const sort = url.searchParams.get("sort") || "created_at";
    const direction = (url.searchParams.get("direction") || "desc").toLowerCase();
    const sortColumn = ({ created_at: "created_at", title: "title" })[sort];
    if (!sortColumn || !["asc", "desc"].includes(direction)) {
      return json({ ok: false, error: "Invalid sort or direction", request_id: rid }, 400, req, env);
    }
    const title = (url.searchParams.get("title") || "").trim().slice(0, 200);
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if ((from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to)))) {
      return json({ ok: false, error: "Invalid from/to date; use an ISO-8601 date", request_id: rid }, 400, req, env);
    }
    const where = ["tenant_id = ?", "sector = ?"];
    const params = [tenant, sector];
    if (title) { where.push("title LIKE ?"); params.push("%" + title.replace(/[\\%_]/g, "\\const SELECT_SQL = "SELECT id, tenant_id, sector, title, payload, created_at FROM enterprise_records WHERE tenant_id = ? AND sector = ? ORDER BY created_at DESC LIMIT 100";
const INSERT_SQL = "INSERT INTO enterprise_records (id, tenant_id, sector, title, payload) VALUES (?, ?, ?, ?, ?)";
async function handleSectorRecords(req, env, ctx, rid, sector) {
  const tenant = (req.headers.get("X-Aston-Tenant") || "global-default").slice(0, 100);
  if (req.method === "GET") {
    let results = [];
    for (const db of [env.ASTON_DB, env.ASTON_DB_BACKUP]) {
      if (!db || results.length) continue;
      try { const r = await db.prepare(SELECT_SQL).bind(tenant, sector).all(); results = r.results || []; }
      catch (e) { console.warn("[RECORDS_READ_FAIL]", safeMessage(e)); }
    }
    return json({ ok: true, request_id: rid, sector, data: results }, 200, req, env);
  }") + "%"); }
    if (from) { where.push("created_at >= ?"); params.push(new Date(from).toISOString()); }
    if (to) { where.push("created_at <= ?"); params.push(new Date(to).toISOString()); }
    const sql = "SELECT id, tenant_id, sector, title, payload, created_at FROM enterprise_records WHERE " +
      where.join(" AND ") + " ORDER BY " + sortColumn + " " + direction.toUpperCase() + " LIMIT ? OFFSET ?";
    params.push(limit, offset);
    let results = null, readFrom = null;
    for (const [name, db] of [["primary", env.ASTON_DB], ["backup", env.ASTON_DB_BACKUP]]) {
      if (!db || results !== null) continue;
      try { const r = await db.prepare(sql).bind(...params).all(); results = r.results || []; readFrom = name; }
      catch (e) { console.warn("[RECORDS_READ_FAIL]", { database: name, error: safeMessage(e) }); }
    }
    if (results === null) return json({ ok: false, error: "Records storage unavailable", request_id: rid }, 503, req, env);
    return json({ ok: true, request_id: rid, sector, data: results, page: { limit, offset, returned: results.length, next_offset: results.length === limit ? offset + limit : null }, read_from: readFrom }, 200, req, env);
  }
  if (req.method === "POST") {
    const parsed = await readBody(req);
    if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);
    const id = crypto.randomUUID();
    const title = typeof parsed.data.title === "string" ? parsed.data.title.slice(0, 200) : "Omni Strategic Record";
    const payload = parsed.data.payload && typeof parsed.data.payload === "object" ? parsed.data.payload : {};
    const written = await writeWithFailover(env, INSERT_SQL, [id, tenant, sector, title, JSON.stringify(payload)]);
    if (env.ASTON_R2) ctx.waitUntil(env.ASTON_R2.put(`records/${sector}/${id}.json`, JSON.stringify({ id, tenant, sector, title, payload })).catch((e) => console.error("[RECORDS_R2_FAIL]", safeMessage(e))));
    return json(written ? { ok: true, request_id: rid, id, sector, stored_in: written } : { ok: false, error: "Could not persist record", request_id: rid }, written ? 201 : 500, req, env);
  }
  return methodNotAllowed(req, env, ["GET", "POST"]);
}

async function handleLedgerTransaction(req, env, ctx, rid) {
  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);
  const { sender, recipient, currency, metadata } = parsed.data;
  const amount = Number(parsed.data.amount);
  if (typeof sender !== "string" || typeof recipient !== "string" || !sender || !recipient)
    return json({ ok: false, error: "Fields 'sender' and 'recipient' are required strings" }, 400, req, env);
  if (!Number.isFinite(amount) || amount <= 0) return json({ ok: false, error: "Field 'amount' must be a positive number" }, 400, req, env);
  const txId = crypto.randomUUID();
  const cur = typeof currency === "string" && /^[A-Za-z]{3,10}$/.test(currency) ? currency.toUpperCase() : "USD";
  const meta = metadata && typeof metadata === "object" ? metadata : {};
  const written = await writeWithFailover(env, "INSERT INTO ledger_transactions (id, sender, recipient, amount, currency, metadata) VALUES (?, ?, ?, ?, ?, ?)", [txId, sender.slice(0, 200), recipient.slice(0, 200), amount, cur, JSON.stringify(meta)]);
  if (!written) return json({ ok: false, error: "Ledger write failed in all databases; transaction NOT recorded", request_id: rid }, 503, req, env);
  if (env.ASTON_R2) ctx.waitUntil(env.ASTON_R2.put(`ledger/${txId}.json`, JSON.stringify({ tx_id: txId, sender, recipient, amount, currency: cur, metadata: meta, timestamp: Date.now() })).catch((e) => console.error("[LEDGER_R2_FAIL]", safeMessage(e))));
  return json({ ok: true, status: "recorded", stored_in: written, transaction_id: txId, request_id: rid }, 201, req, env);
}

async function healthDiagnostics(req, env) {
  const check = async (db) => {
    if (!db) return false;
    try { await db.prepare("SELECT 1").first(); return true; } catch (_) { return false; }
  };
  const primaryD1 = await check(env.ASTON_DB), backupD1 = await check(env.ASTON_DB_BACKUP);
  const ok = primaryD1 || backupD1;
  return json({ ok, service: C.PLATFORM, version: C.VERSION, status_matrix: {
    primary_d1: primaryD1 ? "nominal" : "offline", backup_d1: backupD1 ? "nominal" : "offline",
    r2_data_lake: !!env.ASTON_R2, queues_engine: !!env.EVENTS, kv_sessions: !!env.ASTON_KV,
    workers_ai: !!env.AI, api_token_configured: !!env.ASTON_API_TOKEN
  } }, ok ? 200 : 503, req, env);
}
async function writeWithFailover(env, sql, params) {
  for (const [name, db] of [["primary", env.ASTON_DB], ["backup", env.ASTON_DB_BACKUP]]) {
    if (!db) continue;
    try { await db.prepare(sql).bind(...params).run(); return name; }
    catch (e) { console.warn(`[WRITE_FAIL_${name.toUpperCase()}]`, safeMessage(e)); }
  }
  return null;
}
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function authorized(req, env) {
  if (!env.ASTON_API_TOKEN) return false;
  return safeEqual(req.headers.get("Authorization") || "", `Bearer ${env.ASTON_API_TOKEN}`);
}
function unauthorized(req, env) { return json({ ok: false, error: "Unauthorized" }, 401, req, env); }
function extractText(o) {
  if (typeof o === "string") return o.trim();
  const t = o?.response || o?.text || o?.choices?.[0]?.message?.content || "";
  return typeof t === "string" ? t.trim() : "";
}
async function readBody(req) {
  try {
    const declared = Number(req.headers.get("Content-Length") || 0);
    if (declared > C.MAX_BODY) return { ok: false, error: "Payload too large", status: 413 };
    const text = await req.text();
    if (text.length > C.MAX_BODY) return { ok: false, error: "Payload too large", status: 413 };
    const data = JSON.parse(text || "{}");
    if (data === null || typeof data !== "object" || Array.isArray(data)) return { ok: false, error: "JSON body must be an object", status: 400 };
    return { ok: true, data, status: 200 };
  } catch { return { ok: false, error: "Invalid JSON Body", status: 400 }; }
}
async function getHistory(env, sid) {
  if (!env.ASTON_KV) return [];
  try { const s = await env.ASTON_KV.get(`session:${sid}`, "json"); return Array.isArray(s?.messages) ? s.messages : []; }
  catch (_) { return []; }
}
async function saveHistory(env, sid, userMsg, aiMsg) {
  if (!env.ASTON_KV) return;
  const history = await getHistory(env, sid);
  const updated = [...history, { role: "user", content: userMsg }, { role: "assistant", content: aiMsg }].slice(-25);
  await env.ASTON_KV.put(`session:${sid}`, JSON.stringify({ messages: updated }), { expirationTtl: C.SESSION_TTL });
}
async function processQueueMessage(body, env) {
  if (env.ASTON_DB) await env.ASTON_DB.prepare("INSERT INTO events (id, payload, created_at) VALUES (?, ?, datetime('now'))").bind(crypto.randomUUID(), JSON.stringify(body)).run();
}
async function executeTelemetrySync(env, payload) { if (env.EVENTS) await env.EVENTS.send(payload); }
function preflight(req, env) { return new Response(null, { status: 204, headers: headersFor(req, env) }); }
function json(data, status, req, env) {
  const h = headersFor(req, env); h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: h });
}
function methodNotAllowed(req, env, methods) {
  const r = json({ ok: false, error: "Method Not Allowed" }, 405, req, env); r.headers.set("Allow", methods.join(", ")); return r;
}
function headersFor(req, env) {
  const h = new Headers();
  const origin = req.headers.get("Origin");
  const allowlist = String(env?.ASTON_ALLOWED_ORIGIN || "").split(",").map((v) => v.trim()).filter(Boolean);
  if (origin && allowlist.includes(origin)) h.set("Access-Control-Allow-Origin", origin);
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Aston-Tenant, Idempotency-Key");
  h.set("Vary", "Origin"); h.set("Cache-Control", "no-store"); h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "no-referrer");
  return h;
}
function withTelemetryHeaders(response, req, requestId) {
  const headers = new Headers(response.headers);
  headers.set("X-Request-Id", requestId);
  const colo = req.cf?.colo;
  if (typeof colo === "string" && /^[A-Z0-9]{3,5}$/.test(colo)) headers.set("X-Edge-Colo", colo);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
function parseBoundedInt(raw, fallback, min, max) {
  if (raw === null || raw === "") return fallback;
  if (!/^-?\\d+$/.test(raw)) return NaN;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : NaN;
}
function sessionStorageKey(tenant, sid) {
  const normalized = String(tenant).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 100);
  return "session:" + normalized + ":" + sid;
}
function safeMessage(e) { return typeof e?.message === "string" ? e.message.slice(0, 250) : "Unknown Error"; }
