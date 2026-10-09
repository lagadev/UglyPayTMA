// ============================================================================
// src/sms.js — POST /api/sms/ingest
//
// Auth: Authorization: Bearer <merchant ingest token> (shown in the Mini App).
// The Android app forwards the raw SMS ({ sender, body, receivedAt }); parsing
// happens HERE so message-format fixes never need a new APK. Pre-parsed fields
// ({ trxId, amount, method, senderNumber }) are accepted too.
//
// An SMS can only ever match invoices that belong to the token's merchant.
// ============================================================================
import { json, readJson, bearer, normalizeTrx, normalizeMethod, normalizeBdNumber, AMOUNT_TOLERANCE } from "./utils.js";
import { getInvoice } from "./invoices.js";
import { fireWebhook } from "./webhooks.js";

function detectMethod(sender, text) {
  const s = String(sender || "").toLowerCase();
  const t = String(text || "").toLowerCase();
  if (s.includes("bkash")) return "bkash";
  if (s.includes("nagad")) return "nagad";
  if (s.includes("rocket") || s === "16216") return "rocket";
  if (s.includes("upay")) return "upay";
  if (t.includes("bkash")) return "bkash";
  if (t.includes("nagad")) return "nagad";
  if (t.includes("rocket")) return "rocket";
  if (t.includes("upay")) return "upay";
  return null;
}

// Tolerant parser for "money received" SMS. Returns null for anything else
// (cash-out, send-money, balance, OTP...). Verify against real messages from
// your own wallets — operators change their wording from time to time.
export function parseSms(sender, text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (!/receiv/i.test(t) || /\b(sent|cash ?out|cashout|payment to)\b/i.test(t) && !/received/i.test(t)) return null;
  const method = detectMethod(sender, t);
  const amountM = t.match(/(?:Tk\.?|BDT|৳)\s*([\d,]+(?:\.\d+)?)/i);
  const trxM = t.match(/(?:Trx\s?ID|Txn\s?ID|Transaction\s?ID|TrxId|TxnId)\s*[:\-]?\s*([A-Za-z0-9]{6,})/i);
  const fromM = t.match(/(?:from|sender)\s*[:\-]?\s*(\+?(?:88)?01\d{9})/i);
  if (!method || !amountM || !trxM) return null;
  return {
    method,
    amount: Number(amountM[1].replace(/,/g, "")),
    trxId: normalizeTrx(trxM[1]),
    senderNumber: fromM ? normalizeBdNumber(fromM[1]) : null,
  };
}

export async function ingestSms(request, env, ctx) {
  const token = bearer(request);
  const merchant = token ? await env.DB.prepare(`SELECT * FROM merchants WHERE ingest_token = ?`).bind(token).first() : null;
  if (!merchant) return json({ error: "অননুমোদিত।" }, 401);

  const body = await readJson(request);
  const rawSms = body.body ? String(body.body).slice(0, 1000) : (body.rawSms ? String(body.rawSms).slice(0, 1000) : null);
  const receivedAt = Number(body.receivedAt) || Date.now();

  let p = rawSms ? parseSms(body.sender, rawSms) : null;
  if (!p && body.trxId) {
    p = {
      method: normalizeMethod(body.method) || "bkash",
      amount: Number(body.amount),
      trxId: normalizeTrx(body.trxId),
      senderNumber: body.senderNumber ? normalizeBdNumber(body.senderNumber) : null,
    };
  }
  if (!p || !p.trxId || !(p.amount > 0)) return json({ ok: true, ignored: true, message: "পেমেন্ট রিসিভ SMS নয়, তাই বাদ দেওয়া হয়েছে।" }, 200);

  const smsId = crypto.randomUUID();
  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO sms_transactions (id, merchant_id, trx_id, amount, sender_number, method, received_at, raw_sms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(smsId, merchant.id, p.trxId, p.amount, p.senderNumber, p.method, receivedAt, rawSms, now).run();
  } catch {
    return json({ ok: true, message: "ইতিমধ্যে রেকর্ড করা হয়েছে (ডুপ্লিকেট trxID)।" }, 200);
  }

  let invoice = await env.DB.prepare(
    `SELECT * FROM invoices WHERE merchant_id = ? AND trx_id = ? AND method = ? AND status = 'pending' AND ? BETWEEN created_at AND expires_at LIMIT 1`
  ).bind(merchant.id, p.trxId, p.method, receivedAt).first();

  if (!invoice) {
    const c = await env.DB.prepare(
      `SELECT * FROM invoices WHERE merchant_id = ? AND method = ? AND status = 'pending' AND trx_id IS NULL
         AND ? BETWEEN created_at AND expires_at AND ABS(amount - ?) <= ?`
    ).bind(merchant.id, p.method, receivedAt, p.amount, AMOUNT_TOLERANCE).all();
    if (c.results && c.results.length === 1) invoice = c.results[0];
  }
  if (!invoice) return json({ ok: true, matched: false, message: "SMS জমা হয়েছে, এখনো কোনো মিলে যাওয়া ইনভয়েস পাওয়া যায়নি।" }, 200);

  await env.DB.batch([
    env.DB.prepare(`UPDATE invoices SET status = 'verified', verified_by = 'sms', trx_id = ?, sender_number = COALESCE(sender_number, ?), verified_at = ? WHERE id = ?`)
      .bind(p.trxId, p.senderNumber, now, invoice.id),
    env.DB.prepare(`UPDATE sms_transactions SET matched_invoice_id = ? WHERE id = ?`).bind(invoice.id, smsId),
  ]);
  await fireWebhook(await getInvoice(invoice.id, env), env, ctx);
  return json({ ok: true, matched: true, invoiceId: invoice.id }, 200);
}
