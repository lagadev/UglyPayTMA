// src/utils.js — small stateless helpers.

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

export async function readJson(request) {
  try { return await request.json(); } catch { return {}; }
}

export const METHODS = ["bkash", "nagad", "rocket", "upay"];
export const AMOUNT_TOLERANCE = 0.5;

export function normalizeMethod(method) {
  const m = String(method || "").trim().toLowerCase();
  return METHODS.includes(m) ? m : null;
}
export function normalizeTrx(trx) { return String(trx || "").trim().toUpperCase(); }

// Bangladeshi mobile number -> 01XXXXXXXXX, or null if it doesn't look valid.
export function normalizeBdNumber(raw) {
  let n = String(raw || "").replace(/[\s\-+]/g, "");
  if (n.startsWith("880")) n = "0" + n.slice(3);
  return /^01[3-9]\d{8}$/.test(n) ? n : null;
}

export function bearer(request) {
  const auth = request.headers.get("Authorization") || "";
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : null;
}

const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

export function genId(prefix, len = 8) { return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, len).toUpperCase(); }
export function genApiKey() { return "pk_" + rand(24); }
export function genIngestToken() { return "sms_" + rand(24); }

export async function hmacRaw(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return await crypto.subtle.sign("HMAC", key, dataBytes);
}
export async function signPayload(payload, key) {
  const enc = new TextEncoder();
  return hex(await hmacRaw(enc.encode(key), enc.encode(payload)));
}
export function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// Public, non-secret site config. Set via [vars] in wrangler.toml.
export function siteConfig(env) {
  return {
    siteName: env.SITE_NAME || "PayLink",
    invoiceTtlMinutes: Number(env.INVOICE_TTL_MINUTES) || 15,
    apkUrl: env.APK_URL || "",
    support: { telegram: env.SUPPORT_TELEGRAM || "" },
  };
}
