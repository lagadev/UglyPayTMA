// ============================================================================
// src/tma.js — "no signup / no login" identity via Telegram Mini App initData.
//
// The Mini App sends   Authorization: tma <Telegram.WebApp.initData>
// We verify Telegram's HMAC signature with the bot token, so a request can
// only ever act on the Telegram account that actually opened the app. First
// visit auto-creates the merchant row.
// ============================================================================
import { hmacRaw, timingSafeEqual, genId, genApiKey, genIngestToken, bearer } from "./utils.js";

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

export async function verifyInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = await hmacRaw(enc.encode("WebAppData"), enc.encode(botToken));
  const expected = hex(await hmacRaw(secret, enc.encode(dataCheckString)));
  if (!timingSafeEqual(expected, hash)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

  try {
    const user = JSON.parse(params.get("user") || "null");
    return user && user.id ? user : null;
  } catch { return null; }
}

// Returns the merchant row for the Telegram user (creating it on first use),
// or null when the request carries no valid initData.
export async function getMerchantFromTma(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("tma ")) return null;
  const user = await verifyInitData(auth.slice(4), env.BOT_TOKEN);
  if (!user) return null;

  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").slice(0, 120) || "User";
  const username = user.username ? String(user.username).slice(0, 64) : null;
  const now = Date.now();

  let m = await env.DB.prepare(`SELECT * FROM merchants WHERE tg_id = ?`).bind(user.id).first();
  if (!m) {
    const id = genId("M", 12);
    await env.DB.prepare(
      `INSERT INTO merchants (id, tg_id, display_name, username, api_key, ingest_token, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, user.id, name, username, genApiKey(), genIngestToken(), now, now).run();
    m = await env.DB.prepare(`SELECT * FROM merchants WHERE id = ?`).bind(id).first();
  } else if (m.display_name !== name || m.username !== username) {
    await env.DB.prepare(`UPDATE merchants SET display_name=?, username=?, updated_at=? WHERE id=?`).bind(name, username, now, m.id).run();
    m.display_name = name; m.username = username;
  }
  return m;
}

export async function getMerchantByApiKey(request, env) {
  const key = bearer(request);
  if (!key) return null;
  return await env.DB.prepare(`SELECT * FROM merchants WHERE api_key = ?`).bind(key).first();
}
