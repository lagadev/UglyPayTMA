// ============================================================================
// src/merchants.js — everything a merchant can do from the Mini App:
// view profile/keys, set numbers, enable/disable methods, make pay links.
// ============================================================================
import { json, readJson, genApiKey, genIngestToken, normalizeMethod, normalizeBdNumber, METHODS } from "./utils.js";
import { getMerchantFromTma } from "./tma.js";
import { createInvoiceFor, invoiceToPublic } from "./invoices.js";

export function merchantPublic(m) {
  const methods = {};
  for (const k of METHODS) methods[k] = { number: m[`${k}_number`] || "", enabled: Boolean(m[`${k}_enabled`]) };
  return { id: m.id, name: m.display_name, username: m.username, apiKey: m.api_key, ingestToken: m.ingest_token, methods };
}

async function auth(request, env) {
  if (!env.BOT_TOKEN) return { error: json({ error: "সার্ভারে BOT_TOKEN সেট করা নেই।" }, 500) };
  const m = await getMerchantFromTma(request, env);
  if (!m) return { error: json({ error: "টেলিগ্রাম Mini App থেকে খুলুন।" }, 401) };
  return { m };
}

export async function me(request, env) {
  const { m, error } = await auth(request, env); if (error) return error;
  return json(merchantPublic(m), 200);
}

// POST /api/me/methods  { method, number?, enabled? }
export async function updateMethod(request, env) {
  const { m, error } = await auth(request, env); if (error) return error;
  const body = await readJson(request);
  const method = normalizeMethod(body.method);
  if (!method) return json({ error: "method অবশ্যই bkash, nagad, rocket অথবা upay হতে হবে।" }, 400);

  let number = m[`${method}_number`] || null;
  let enabled = Boolean(m[`${method}_enabled`]);

  if (body.number !== undefined) {
    const raw = String(body.number).trim();
    if (raw === "") { number = null; enabled = false; }
    else {
      number = normalizeBdNumber(raw);
      if (!number) return json({ error: "সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (যেমন 01XXXXXXXXX)।" }, 400);
    }
  }
  if (body.enabled !== undefined) enabled = Boolean(body.enabled);
  if (enabled && !number) return json({ error: "চালু করার আগে নম্বর সেট করুন।" }, 400);

  // `method` is whitelisted above, so interpolating the column name is safe.
  await env.DB.prepare(`UPDATE merchants SET ${method}_number=?, ${method}_enabled=?, updated_at=? WHERE id=?`)
    .bind(number, enabled ? 1 : 0, Date.now(), m.id).run();
  const fresh = await env.DB.prepare(`SELECT * FROM merchants WHERE id=?`).bind(m.id).first();
  return json(merchantPublic(fresh), 200);
}

// POST /api/me/keys/regenerate  { which: "api" | "ingest" }
export async function regenerateKey(request, env) {
  const { m, error } = await auth(request, env); if (error) return error;
  const body = await readJson(request);
  const col = body.which === "ingest" ? "ingest_token" : body.which === "api" ? "api_key" : null;
  if (!col) return json({ error: "which অবশ্যই api অথবা ingest হতে হবে।" }, 400);
  const value = col === "api_key" ? genApiKey() : genIngestToken();
  await env.DB.prepare(`UPDATE merchants SET ${col}=?, updated_at=? WHERE id=?`).bind(value, Date.now(), m.id).run();
  const fresh = await env.DB.prepare(`SELECT * FROM merchants WHERE id=?`).bind(m.id).first();
  return json(merchantPublic(fresh), 200);
}

export async function listInvoices(request, env) {
  const { m, error } = await auth(request, env); if (error) return error;
  const rows = await env.DB.prepare(`SELECT * FROM invoices WHERE merchant_id=? ORDER BY created_at DESC LIMIT 30`).bind(m.id).all();
  return json({ invoices: (rows.results || []).map(invoiceToPublic) }, 200);
}

// POST /api/me/invoices  { amount, reference? } — quick pay link from the app
export async function createMyInvoice(request, env, url) {
  const { m, error } = await auth(request, env); if (error) return error;
  const body = await readJson(request);
  return await createInvoiceFor(m, body, env, url);
}
