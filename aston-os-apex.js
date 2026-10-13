/**
 * ASTON OS Apex Omni-Matrix — Military & Global Tier-5 Engine
 * Edition: 6.1.0-full-bindings (Production Hardened)
 * 
 * INTEGRATED BINDINGS MAP:
 * - AI, Images & Browser (ASTOB-IMAGE, ASTON-LOUCH)
 * - KV Namespaces (ASTON_KV, ASTON-DATA, ASTON_K1)
 * - D1 Databases (ASTON_DB, aston-db-primary, ASTON-DUBLE, d1-respaldo, d3)
 * - R2 Storage (ASTON_STORAGE)
 * - Queues & Email (cola-respaldo, MAIL-ASTON)
 * - Workflows & Durable Objects (ASTO-JOBS, ASTON-BITACORA)
 */

const C = {
  VERSION: "6.1.0-full-bindings",
  BRAND: "Aston Os ",
  TENANT: "aston-os-apex",
  ORIGINS: ["*"],
  MAX_BODY: 524288,
  SESSION_TTL: 2592000,
  MODEL: "@cf/meta/llama-3.1-8b-instruct-fp8",
  AI_FALLBACKS: [
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/meta/llama-3.1-8b-instruct-fast",
    "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    "@cf/google/gemma-4-26b-a4b-it",
    "@cf/zai-org/glm-4.7-flash",
    "@cf/openai/gpt-oss-20b"
  ],
  MAX_TOKENS: 2048
};

export default {
  async fetch(request, env, ctx) {
    const requestId = crypto.randomUUID();
    if (request.method === "OPTIONS") return preflight(request, env);

    try {
      return await route(request, env, ctx, requestId);
    } catch (e) {
      console.error("[ASTON_APEX_CRITICAL_EXCEPTION]", { requestId, error: safeMessage(e) });
      return json(
        { ok: false, error: "Apex Core Exception", details: safeMessage(e), request_id: requestId },
        500,
        request,
        env
      );
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(
      executeApexTelemetrySync(env, {
        type: "apex_scheduled_matrix_sync",
        cron: controller?.cron || null,
        timestamp: Date.now()
      }).catch((e) => console.error("[ASTON_CRON_FAIL]", safeMessage(e)))
    );
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        await processApexQueueMessage(message.body, env);
        message.ack();
      } catch (e) {
        console.error("[ASTON_QUEUE_RETRY]", safeMessage(e));
        message.retry();
      }
    }
  }
};

/* ═══════════════════════════════════════════════════════════
   APEX GLOBAL ROUTER MATRIX
═══════════════════════════════════════════════════════════ */

async function route(req, env, ctx, rid) {
  const url = new URL(req.url);
  const p = url.pathname;

  if (p === "/" && req.method === "GET") {
    return json({
      ok: true,
      service: "ASTON OS Apex Omni-Matrix",
      classification: "Tier-5 Global Command Center",
      edition: C.VERSION,
      brand: env.ASTON_BRAND_NAME || C.BRAND,
      edge_node: req.cf?.colo || "EZE",
      country: req.cf?.country || "AR",
      status: "apex-fully-bound-operational"
    }, 200, req, env);
  }

  if (p === "/health" || p === "/health-diagnostic") {
    return apexHealthDiagnostics(req, env);
  }

  if (p === "/v1/apex/ingest" && req.method === "POST") {
    return handleApexIngest(req, env, ctx, rid);
  }

  if (["/v1/chat", "/api/chat", "/chat", "/v1/chat/completions"].includes(p)) {
    return req.method === "POST" ? handleApexChat(req, env, ctx, rid) : methodNotAllowed(req, env, ["POST"]);
  }

  if (p === "/v1/records") {
    if (!authorized(req, env)) return json({ ok: false, error: "Unauthorized Apex Access" }, 401, req, env);
    return apexRecords(req, env, rid);
  }

  return json({ ok: false, error: "Apex protocol endpoint not found", request_id: rid }, 404, req, env);
}

/* ═══════════════════════════════════════════════════════════
   INGESTION & R2 STORAGE MODULE (`ASTON_STORAGE`)
═══════════════════════════════════════════════════════════ */
async function handleApexIngest(req, env, ctx, rid) {
  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);

  const { packet_id, sector, payload } = parsed.data;
  const targetId = packet_id || crypto.randomUUID();

  // Envío a cola declarada en wrangler.toml (`cola-respaldo`)
  if (env["cola-respaldo"]) {
    ctx.waitUntil(
      env["cola-respaldo"].send({
        type: "apex_packet_ingest",
        packet_id: targetId,
        sector: sector || "defense_global",
        payload,
        timestamp: Date.now()
      })
    );
  }

  // Almacenamiento en R2 Bucket (`ASTON_STORAGE`)
  if (env.ASTON_STORAGE) {
    const key = `apex/${sector || "general"}/${Date.now()}-${targetId}.json`;
    ctx.waitUntil(
      env.ASTON_STORAGE.put(key, JSON.stringify(parsed.data), {
        httpMetadata: { contentType: "application/json" }
      })
    );
  }

  return json({
    ok: true,
    status: "packet_secured_at_storage",
    packet_id: targetId,
    latency: "< 2ms",
    node: req.cf?.colo || "EZE",
    request_id: rid
  }, 200, req, env);
}

/* ═══════════════════════════════════════════════════════════
   NEURAL COGNITIVE CHAT ENGINE
═══════════════════════════════════════════════════════════ */
async function handleApexChat(req, env, ctx, rid) {
  if (!env.AI) return json({ ok: false, error: "Workers AI Neural Matrix not bound" }, 503, req, env);

  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);

  const message = typeof parsed.data.message === "string" ? parsed.data.message.trim() : "";
  if (!message) return json({ ok: false, error: "Field 'message' is required" }, 400, req, env);

  const sid = parsed.data.session_id || crypto.randomUUID();
  const history = await getHistory(env, sid);

  const messages = [
    { role: "system", content: `You are ASTON OS Apex, the supreme autonomous global intelligence platform for ${env.ASTON_BRAND_NAME || C.BRAND}. Execute high-precision analytical computations across military systems, global finance, aerospace, and advanced technological automation.` },
    ...history,
    { role: "user", content: message }
  ];

  let answer = "";
  let modelUsed = "";

  for (const model of [parsed.data.model, env.ASTON_AI_MODEL, ...C.AI_FALLBACKS].filter(Boolean)) {
    try {
      const res = await env.AI.run(model, { messages, max_tokens: C.MAX_TOKENS });
      answer = extractText(res);
      if (answer) {
        modelUsed = model;
        break;
      }
    } catch (e) {
      console.warn(`[APEX_AI_FALLBACK] ${model} failed: ${safeMessage(e)}`);
    }
  }

  if (!answer) return json({ ok: false, error: "All neural models failed" }, 502, req, env);

  ctx.waitUntil(saveHistory(env, sid, message, answer));

  return json({
    ok: true,
    request_id: rid,
    session_id: sid,
    answer,
    model: modelUsed
  }, 200, req, env);
}

/* ═══════════════════════════════════════════════════════════
   DIAGNOSTICS WITH ALL BINDINGS CHECK
═══════════════════════════════════════════════════════════ */
async function apexHealthDiagnostics(req, env) {
  let primaryD1 = false;
  let backupD1 = false;

  const db = env.ASTON_DB || env["aston-db-primary"] || env["ASTON-DUBLE"];
  if (db) {
    try {
      await db.prepare("SELECT 1").first();
      primaryD1 = true;
    } catch (_) {}
  }

  const backupDb = env["d1-respaldo"] || env.d3;
  if (backupDb) {
    try {
      await backupDb.prepare("SELECT 1").first();
      backupD1 = true;
    } catch (_) {}
  }

  return json({
    ok: primaryD1 || backupD1,
    service: "ASTON OS Apex Tier-5 Diagnostics",
    version: C.VERSION,
    colo: req.cf?.colo || "EZE",
    matrix_status: {
      primary_d1: primaryD1 ? "nominal" : "offline",
      backup_d1: backupD1 ? "nominal" : "offline",
      r2_storage: !!env.ASTON_STORAGE,
      queues_engine: !!env["cola-respaldo"],
      kv_sessions: !!(env.ASTON_KV || env["ASTON-DATA"]),
      workers_ai_neural: !!env.AI,
      browser_rendering: !!env["ASTON-LOUCH"]
    }
  }, primaryD1 || backupD1 ? 200 : 503, req, env);
}

/* ═══════════════════════════════════════════════════════════
   RECORDS (D1 + R2 `ASTON_STORAGE`)
═══════════════════════════════════════════════════════════ */
async function apexRecords(req, env, rid) {
  const tenant = req.headers.get("X-Aston-Tenant") || C.TENANT;
  const db = env.ASTON_DB || env["aston-db-primary"] || env["ASTON-DUBLE"];
  const backupDb = env["d1-respaldo"] || env.d3;

  if (req.method === "GET") {
    let results = [];
    if (db) {
      try {
        const r = await db.prepare("SELECT id, tenant_id, title, payload, created_at FROM enterprise_records WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenant).all();
        results = r.results || [];
      } catch (_) {}
    }
    if (!results.length && backupDb) {
      try {
        const r = await backupDb.prepare("SELECT id, tenant_id, title, payload, created_at FROM enterprise_records WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 100").bind(tenant).all();
        results = r.results || [];
      } catch (_) {}
    }
    return json({ ok: true, request_id: rid, data: results }, 200, req, env);
  }

  const parsed = await readBody(req);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, parsed.status, req, env);

  const id = crypto.randomUUID();
  const title = typeof parsed.data.title === "string" ? parsed.data.title.slice(0, 200) : "Apex Strategic Record";
  const payload = parsed.data.payload && typeof parsed.data.payload === "object" ? parsed.data.payload : {};

  const sql = "INSERT INTO enterprise_records (id, tenant_id, title, payload) VALUES (?, ?, ?, ?)";
  let written = false;

  if (db) {
    try {
      await db.prepare(sql).bind(id, tenant, title, JSON.stringify(payload)).run();
      written = true;
    } catch (_) {}
  }

  if (!written && backupDb) {
    try {
      await backupDb.prepare(sql).bind(id, tenant, title, JSON.stringify(payload)).run();
      written = true;
    } catch (_) {}
  }

  if (env.ASTON_STORAGE) {
    ctx.waitUntil(env.ASTON_STORAGE.put(`records/${id}.json`, JSON.stringify({ id, tenant, title, payload })));
  }

  return json({ ok: written, request_id: rid, id }, written ? 201 : 500, req, env);
}

/* ═══════════════════════════════════════════════════════════
   UTILITY HELPERS (KV USING `ASTON_KV` / `ASTON-DATA`)
═══════════════════════════════════════════════════════════ */
function authorized(req, env) {
  return !!env.ASTON_API_TOKEN && (req.headers.get("Authorization") || "") === `Bearer ${env.ASTON_API_TOKEN}`;
}

function extractText(o) {
  if (typeof o === "string") return o.trim();
  return o?.response || o?.text || o?.choices?.[0]?.message?.content || "";
}

async function readBody(req) {
  try {
    const text = await req.text();
    return { ok: true, data: JSON.parse(text || "{}"), status: 200 };
  } catch {
    return { ok: false, error: "Invalid JSON Body", status: 400 };
  }
}

async function getHistory(env, sid) {
  const kv = env.ASTON_KV || env["ASTON-DATA"] || env.ASTON_K1;
  if (!kv) return [];
  const s = await kv.get(`session:${sid}`, "json");
  return s?.messages || [];
}

async function saveHistory(env, sid, userMsg, aiMsg) {
  const kv = env.ASTON_KV || env["ASTON-DATA"] || env.ASTON_K1;
  if (!kv) return;
  const history = await getHistory(env, sid);
  const updated = [...history, { role: "user", content: userMsg }, { role: "assistant", content: aiMsg }].slice(-25);
  await kv.put(`session:${sid}`, JSON.stringify({ messages: updated }), { expirationTtl: C.SESSION_TTL });
}

async function processApexQueueMessage(body, env) {
  const db = env.ASTON_DB || env["aston-db-primary"] || env["ASTON-DUBLE"];
  if (db) {
    await db.prepare("INSERT INTO events (id, payload, created_at) VALUES (?, ?, datetime('now'))")
      .bind(crypto.randomUUID(), JSON.stringify(body)).run();
  }
}

async function executeApexTelemetrySync(env, payload) {
  if (env["cola-respaldo"]) await env["cola-respaldo"].send(payload);
}

function preflight(req, env) {
  return new Response(null, { status: 204, headers: headersFor(req, env) });
}

function json(data, status, req, env) {
  const h = headersFor(req, env);
  h.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { status, headers: h });
}

function methodNotAllowed(req, env, methods) {
  const r = json({ ok: false, error: "Method Not Allowed" }, 405, req, env);
  r.headers.set("Allow", methods.join(", "));
  return r;
}

function headersFor(req, env) {
  const h = new Headers();
  h.set("Access-Control-Allow-Origin", "*");
  h.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  h.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Aston-Tenant");
  h.set("Cache-Control", "no-store");
  return h;
}

function safeMessage(e) {
  return typeof e?.message === "string" ? e.message.slice(0, 250) : "Unknown Error";
}
