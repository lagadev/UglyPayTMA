// ============================================================================
// src/invoices.js — invoice creation (merchant API key or Mini App) and the
// public customer flow (fetch / select method / verify). Money goes straight
// to the merchant's own number, so there is no balance, fee or payout here.
// ============================================================================
import { json, readJson, genId, normalizeMethod, normalizeTrx, siteConfig, METHODS, AMOUNT_TOLERANCE } from "./utils.js";
import { getMerchantByApiKey } from "./tma.js";
import { fireWebhook } from "./webhooks.js";

export function invoiceToPublic(inv) {
  return {
    id: inv.id, reference: inv.reference, amount: inv.amount, method: inv.method,
    merchantNumber: inv.merchant_number, status: inv.status, trxId: inv.trx_id,
    senderNumber: inv.sender_number, createdAt: inv.created_at, expiresAt: inv.expires_at, verifiedAt: inv.verified_at,
  };
}

const methodUsable = (m, k) => Boolean(m[`${k}_enabled`]) && Boolean(m[`${k}_number`]);

export async function createInvoiceFor(merchant, body, env, url) {
  const amount = Number(body.amount);
  const reference = body.reference ? String(body.reference).slice(0, 128) : null;
  const callbackUrl = body.callbackUrl ? String(body.callbackUrl).slice(0, 500) : null;
  const method = body.method ? normalizeMethod(body.method) : null;

  if (!amount || amount <= 0 || amount > 1000000) return json({ error: "একটি সঠিক পরিমাণ ('amount') আবশ্যক।" }, 400);
  if (!METHODS.some((k) => methodUsable(merchant, k))) return json({ error: "আগে অন্তত একটি পেমেন্ট মেথডের নম্বর সেট করে চালু করুন।" }, 400);
  if (method && !methodUsable(merchant, method)) return json({ error: "এই পেমেন্ট মেথডটি বর্তমানে বন্ধ আছে।" }, 400);

  const id = genId("INV-", 8);
  const now = Date.now();
  const expiresAt = now + siteConfig(env).invoiceTtlMinutes * 60 * 1000;
  const number = method ? merchant[`${method}_number`] : null;

  await env.DB.prepare(
    `INSERT INTO invoices (id, merchant_id, reference, amount, method, merchant_number, status, callback_url, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`
  ).bind(id, merchant.id, reference, amount, method, number, callbackUrl, now, expiresAt).run();

  return json({ id, reference, amount, method, merchantNumber: number, status: "pending", createdAt: now, expiresAt, payUrl: `${url.origin}/pay?id=${id}` }, 201);
}

// POST /api/invoices — server-to-server, Bearer <merchant api key>
export async function createInvoice(request, env, url) {
  const merchant = await getMerchantByApiKey(request, env);
  if (!merchant) return json({ error: "অননুমোদিত। Authorization: Bearer <আপনার API key> পাঠান।" }, 401);
  return await createInvoiceFor(merchant, await readJson(request), env, url);
}

export async function getInvoice(id, env) {
  const invoice = await env.DB.prepare(`SELECT * FROM invoices WHERE id = ?`).bind(id).first();
  if (!invoice) return null;
  if (invoice.status === "pending" && Date.now() > invoice.expires_at) {
    await env.DB.prepare(`UPDATE invoices SET status = 'expired' WHERE id = ?`).bind(id).run();
    invoice.status = "expired";
  }
  return invoice;
}

// Public view for the pay page: the invoice + which methods this merchant has
// switched on (booleans only — the number is revealed once a method is chosen).
async function publicWithMerchant(inv, env) {
  const m = await env.DB.prepare(`SELECT * FROM merchants WHERE id = ?`).bind(inv.merchant_id).first();
  const methods = {};
  for (const k of METHODS) methods[k] = m ? methodUsable(m, k) : false;
  return { ...invoiceToPublic(inv), merchantName: m ? m.display_name : "", methods };
}

export async function getInvoiceRoute(id, env) {
  const invoice = await getInvoice(id, env);
  if (!invoice) return json({ error: "ইনভয়েস পাওয়া যায়নি।" }, 404);
  return json(await publicWithMerchant(invoice, env), 200);
}

export async function selectMethod(id, request, env) {
  const invoice = await getInvoice(id, env);
  if (!invoice) return json({ error: "ইনভয়েস পাওয়া যায়নি।" }, 404);
  if (invoice.status !== "pending") return json({ ...invoiceToPublic(invoice), error: "এই ইনভয়েসটি আর পেন্ডিং নেই।" }, 409);

  const method = normalizeMethod((await readJson(request)).method);
  if (!method) return json({ error: "method অবশ্যই bkash, nagad, rocket অথবা upay হতে হবে।" }, 400);

  const m = await env.DB.prepare(`SELECT * FROM merchants WHERE id = ?`).bind(invoice.merchant_id).first();
  if (!m || !methodUsable(m, method)) return json({ error: "এই পেমেন্ট মেথডটি বর্তমানে বন্ধ আছে।" }, 400);

  await env.DB.prepare(`UPDATE invoices SET method = ?, merchant_number = ? WHERE id = ?`).bind(method, m[`${method}_number`], id).run();
  return json(await publicWithMerchant(await getInvoice(id, env), env), 200);
}

export async function verifyInvoice(id, request, env, ctx) {
  const invoice = await getInvoice(id, env);
  if (!invoice) return json({ error: "ইনভয়েস পাওয়া যায়নি।" }, 404);
  if (invoice.status === "verified") return json({ ...invoiceToPublic(invoice), message: "ইতিমধ্যে যাচাই হয়ে গেছে।" }, 200);
  if (invoice.status === "expired") return json({ ...invoiceToPublic(invoice), message: "এই ইনভয়েসের মেয়াদ শেষ হয়ে গেছে। নতুন পেমেন্ট লিংক নিন।" }, 409);
  if (!invoice.method) return json({ error: "আগে একটি পেমেন্ট মেথড সিলেক্ট করুন।" }, 400);

  const body = await readJson(request);
  const trxId = normalizeTrx(body.trxId);
  const senderNumber = body.senderNumber ? String(body.senderNumber).trim().slice(0, 20) : null;
  if (!trxId || trxId.length < 5) return json({ error: "সঠিক একটি Transaction ID দিন।" }, 400);

  const reused = await env.DB.prepare(`SELECT id FROM invoices WHERE trx_id = ? AND method = ? AND status = 'verified' AND id != ?`).bind(trxId, invoice.method, id).first();
  if (reused) return json({ error: "এই Transaction ID দিয়ে ইতিমধ্যে অন্য একটি পেমেন্ট যাচাই করা হয়েছে।" }, 409);

  await env.DB.prepare(`UPDATE invoices SET trx_id = ?, sender_number = ? WHERE id = ?`).bind(trxId, senderNumber, id).run();

  // Only this merchant's own SMS can verify this merchant's invoice.
  const match = await env.DB.prepare(
    `SELECT * FROM sms_transactions WHERE merchant_id = ? AND trx_id = ? AND method = ? AND matched_invoice_id IS NULL
       AND received_at BETWEEN ? AND ? AND ABS(amount - ?) <= ? LIMIT 1`
  ).bind(invoice.merchant_id, trxId, invoice.method, invoice.created_at, invoice.expires_at, invoice.amount, AMOUNT_TOLERANCE).first();

  if (!match) {
    return json({ ...invoiceToPublic(invoice), trxId, senderNumber, status: "pending",
      message: "SMS কনফার্মেশনের অপেক্ষায় আছি — এই পেজ খোলা রাখুন, কয়েক সেকেন্ডের মধ্যে নিজে থেকেই যাচাই হয়ে যাবে।" }, 202);
  }

  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(`UPDATE invoices SET status = 'verified', verified_by = 'sms', verified_at = ? WHERE id = ?`).bind(now, id),
    env.DB.prepare(`UPDATE sms_transactions SET matched_invoice_id = ? WHERE id = ?`).bind(id, match.id),
  ]);
  const final = await getInvoice(id, env);
  await fireWebhook(final, env, ctx);
  return json({ ...invoiceToPublic(final), message: "পেমেন্ট সফলভাবে যাচাই হয়েছে।" }, 200);
}
