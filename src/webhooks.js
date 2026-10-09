// ============================================================================
// src/webhooks.js — signed POST to the invoice's callbackUrl once verified.
// X-Signature = HMAC-SHA256(body, merchant API key).
// ============================================================================
import { signPayload } from "./utils.js";

export async function fireWebhook(invoice, env, ctx) {
  if (!invoice || !invoice.callback_url) return;
  const send = (async () => {
    const m = await env.DB.prepare(`SELECT api_key FROM merchants WHERE id = ?`).bind(invoice.merchant_id).first();
    if (!m) return;
    const payload = JSON.stringify({
      event: "invoice.verified", id: invoice.id, reference: invoice.reference, amount: invoice.amount,
      method: invoice.method, trxId: invoice.trx_id, senderNumber: invoice.sender_number, verifiedAt: invoice.verified_at,
    });
    await fetch(invoice.callback_url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Signature": await signPayload(payload, m.api_key) },
      body: payload,
    }).catch(() => {});
  })();
  if (ctx && ctx.waitUntil) ctx.waitUntil(send); else await send;
}
