// ============================================================================
// src/index.js — PayLink (TMA edition) Worker entry. Static pages in public/
// are served by Cloudflare's asset layer; only /api/* reaches this file.
// No admin routes, no signup/login: identity = verified Telegram initData.
// ============================================================================
import { json, corsHeaders, siteConfig } from "./utils.js";
import { me, updateMethod, regenerateKey, listInvoices, createMyInvoice } from "./merchants.js";
import { createInvoice, getInvoiceRoute, selectMethod, verifyInvoice } from "./invoices.js";
import { ingestSms } from "./sms.js";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;
    if (method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    // ---- static files (index.html, pay.html, docs.html, css, js, assets) ----
    // run_worker_first = true হলে সব request এখানে আসে, তাই /api ছাড়া সব ASSETS-এ পাঠাও
    if (!pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    try {
      if (pathname === "/api/config" && method === "GET") return json(siteConfig(env), 200);
      if (pathname === "/api/health") return json({ ok: true, time: Date.now() }, 200);

      // ---- Mini App (Authorization: tma <initData>) ----------------------
      if (pathname === "/api/me" && method === "GET") return await me(request, env);
      if (pathname === "/api/me/methods" && method === "POST") return await updateMethod(request, env);
      if (pathname === "/api/me/keys/regenerate" && method === "POST") return await regenerateKey(request, env);
      if (pathname === "/api/me/invoices" && method === "GET") return await listInvoices(request, env);
      if (pathname === "/api/me/invoices" && method === "POST") return await createMyInvoice(request, env, url);

      // ---- invoices -------------------------------------------------------
      if (pathname === "/api/invoices" && method === "POST") return await createInvoice(request, env, url);
      let m = pathname.match(/^\/api\/invoices\/([a-zA-Z0-9-]+)$/);
      if (m && method === "GET") return await getInvoiceRoute(m[1], env);
      m = pathname.match(/^\/api\/invoices\/([a-zA-Z0-9-]+)\/select-method$/);
      if (m && method === "POST") return await selectMethod(m[1], request, env);
      m = pathname.match(/^\/api\/invoices\/([a-zA-Z0-9-]+)\/verify$/);
      if (m && method === "POST") return await verifyInvoice(m[1], request, env, ctx);

      // ---- SMS app (Bearer <ingest token>) -------------------------------
      if (pathname === "/api/sms/ingest" && method === "POST") return await ingestSms(request, env, ctx);

      return json({ error: "Not found." }, 404);
    } catch (err) {
      console.error("Worker error:", pathname, err && err.stack ? err.stack : err);
      return json({ error: "সার্ভারে সমস্যা হয়েছে।" }, 500);
    }
  },
};
