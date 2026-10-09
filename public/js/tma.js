/* ============================================================================
   public/js/tma.js — the Telegram Mini App (no signup, no login, no admin).
   Identity is Telegram's signed initData, verified on the server.
============================================================================ */
(function () {
  var PL = window.PayLink;
  var tg = window.Telegram && window.Telegram.WebApp;
  var el = function (id) { return document.getElementById(id); };
  var ORDER = ["bkash", "nagad", "rocket", "upay"];
  var NAMES = { bkash: "bKash", nagad: "Nagad", rocket: "Rocket", upay: "Upay" };
  var me = null, cfg = {};

  if (!tg || !tg.initData) { el("blocked").style.display = "block"; return; }
  tg.ready(); tg.expand();
  el("app").style.display = "block";

  // ---- tabs --------------------------------------------------------------
  var TABS = [["methods", "wallet", "মেথড"], ["links", "bolt", "লিংক"], ["setup", "android", "SMS ও API"]];
  el("tabBar").innerHTML = TABS.map(function (t) {
    return '<button data-tab="' + t[0] + '">' + PL.icon(t[1]) + "<span>" + t[2] + "</span></button>";
  }).join("");
  function openTab(name) {
    Array.prototype.forEach.call(document.querySelectorAll(".tabpane"), function (p) { p.classList.toggle("show", p.id === "tab-" + name); });
    Array.prototype.forEach.call(document.querySelectorAll("#tabBar button"), function (b) { b.classList.toggle("active", b.getAttribute("data-tab") === name); });
    if (name === "links") loadInvoices();
  }
  el("tabBar").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (b) openTab(b.getAttribute("data-tab"));
  });
  openTab("methods");

  // ---- helpers -----------------------------------------------------------
  function copy(text, btn) {
    function done() { if (btn) { var o = btn.textContent; btn.textContent = "✓"; setTimeout(function () { btn.textContent = o; }, 1200); } else PL.showToast("কপি হয়েছে", "good"); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var t = document.createElement("textarea"); t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); done(); } catch (e) {} document.body.removeChild(t);
    }
  }
  function confirmBox(msg, cb) {
    if (tg.showConfirm) tg.showConfirm(msg, function (ok) { if (ok) cb(); });
    else if (confirm(msg)) cb();
  }
  function mask(v) { return v ? v.slice(0, 6) + "••••••••••••" + v.slice(-4) : ""; }

  // ---- profile + methods -------------------------------------------------
  function applyMe(m) {
    me = m;
    el("whoName").textContent = "হ্যালো, " + (m.name || "").split(" ")[0] + "!";
    el("avatar").textContent = (m.name || "?").charAt(0).toUpperCase();
    renderMethods();
    el("ingestTok").textContent = mask(m.ingestToken); el("ingestTok").setAttribute("data-full", m.ingestToken); el("ingestTok").setAttribute("data-masked", "1");
    el("apiKey").textContent = mask(m.apiKey); el("apiKey").setAttribute("data-full", m.apiKey); el("apiKey").setAttribute("data-masked", "1");
  }

  function renderMethods() {
    el("methodCards").innerHTML = ORDER.map(function (k) {
      var x = me.methods[k];
      return (
        '<div class="mcard" data-m="' + k + '">' +
        '<div class="head"><img src="/assets/methods/' + k + '.svg" alt="" /><div class="nm">' + NAMES[k] + "</div>" +
        '<span class="st' + (x.enabled ? " on" : "") + '">' + (x.enabled ? "চালু" : "বন্ধ") + "</span>" +
        '<label class="switch"><input type="checkbox" class="tg"' + (x.enabled ? " checked" : "") + (x.number ? "" : " disabled") + ' /><span class="track"></span></label></div>' +
        '<div class="line"><input class="num" inputmode="numeric" maxlength="14" placeholder="01XXXXXXXXX" value="' + PL.esc(x.number) + '" />' +
        '<button class="btn btn-ghost save">সেভ</button></div></div>'
      );
    }).join("");
  }

  function postMethod(payload) {
    return PL.tmaFetch("/api/me/methods", { method: "POST", body: JSON.stringify(payload) }).then(function (r) {
      if (!r.res.ok) { PL.showToast(r.data.error || "সেভ করা যায়নি।", "bad"); renderMethods(); return; }
      applyMe(r.data); PL.showToast("সেভ হয়েছে", "good");
    });
  }

  el("methodCards").addEventListener("click", function (e) {
    var btn = e.target.closest(".save"); if (!btn) return;
    var card = btn.closest(".mcard");
    postMethod({ method: card.getAttribute("data-m"), number: card.querySelector(".num").value });
  });
  el("methodCards").addEventListener("change", function (e) {
    if (!e.target.classList.contains("tg")) return;
    var card = e.target.closest(".mcard");
    postMethod({ method: card.getAttribute("data-m"), enabled: e.target.checked });
  });

  // ---- pay links ---------------------------------------------------------
  el("makeLink").addEventListener("click", function () {
    var amount = Number(el("amt").value);
    if (!(amount > 0)) { PL.showToast("সঠিক পরিমাণ দিন।", "bad"); return; }
    el("makeLink").disabled = true;
    PL.tmaFetch("/api/me/invoices", { method: "POST", body: JSON.stringify({ amount: amount, reference: el("ref").value.trim() || null }) })
      .then(function (r) {
        el("makeLink").disabled = false;
        if (!r.res.ok) { PL.showToast(r.data.error || "লিংক তৈরি করা যায়নি।", "bad"); return; }
        el("linkUrl").textContent = r.data.payUrl;
        el("openLink").href = r.data.payUrl;
        el("linkBox").classList.add("show");
        loadInvoices();
      }).catch(function () { el("makeLink").disabled = false; PL.showToast("নেটওয়ার্ক সমস্যা।", "bad"); });
  });
  el("copyLink").addEventListener("click", function () { copy(el("linkUrl").textContent, el("copyLink")); });

  function loadInvoices() {
    PL.tmaFetch("/api/me/invoices").then(function (r) {
      var items = (r.data && r.data.invoices) || [];
      if (!items.length) { el("invList").innerHTML = '<div class="empty">এখনো কোনো ইনভয়েস নেই</div>'; return; }
      el("invList").innerHTML = items.map(function (i) {
        var when = new Date(i.verifiedAt || i.createdAt).toLocaleString("bn-BD");
        return '<div class="row"><div class="l"><div class="t1">' + PL.esc(i.reference || i.id) + '</div>' +
          '<div class="t2">' + (i.method ? NAMES[i.method] + " · " : "") + (i.trxId ? PL.esc(i.trxId) + " · " : "") + when + "</div></div>" +
          '<div class="r"><div class="amt" style="color:var(--ink)">৳' + PL.fmt(i.amount) + '</div><span class="badge ' + i.status + '">' + i.status + "</span></div></div>";
      }).join("");
    });
  }

  // ---- SMS app + API ------------------------------------------------------
  el("hSms").innerHTML = PL.icon("android") + " SMS অ্যাপ (Android)";
  el("hApi").innerHTML = PL.icon("key") + " API Key";
  el("srvUrl").textContent = location.origin;

  PL.loadConfig().then(function (c) {
    cfg = c;
    var b = el("apkBtn");
    if (c.apkUrl) { b.href = c.apkUrl; b.innerHTML = PL.icon("down") + " APK ডাউনলোড করুন"; }
    else { b.style.display = "none"; el("apkMissing").style.display = "block"; }
  });

  function bindSecret(showId, codeId) {
    el(showId).addEventListener("click", function () {
      var c = el(codeId), masked = c.getAttribute("data-masked") === "1";
      c.textContent = masked ? c.getAttribute("data-full") : mask(c.getAttribute("data-full"));
      c.setAttribute("data-masked", masked ? "0" : "1");
      el(showId).textContent = masked ? "লুকান" : "দেখুন";
    });
  }
  bindSecret("showIngest", "ingestTok"); bindSecret("showApi", "apiKey");

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-copy]"); if (!b) return;
    var c = el(b.getAttribute("data-copy"));
    copy(c.getAttribute("data-full") || c.textContent, b);
  });

  function regen(which, label) {
    confirmBox(label + " বদলালে পুরনোটি আর কাজ করবে না। চালিয়ে যাবেন?", function () {
      PL.tmaFetch("/api/me/keys/regenerate", { method: "POST", body: JSON.stringify({ which: which }) }).then(function (r) {
        if (!r.res.ok) { PL.showToast(r.data.error || "ব্যর্থ হয়েছে।", "bad"); return; }
        applyMe(r.data); PL.showToast("নতুন " + label + " তৈরি হয়েছে", "good");
      });
    });
  }
  el("regenIngest").addEventListener("click", function () { regen("ingest", "SMS Token"); });
  el("regenApi").addEventListener("click", function () { regen("api", "API Key"); });

  // ---- boot --------------------------------------------------------------
  PL.tmaFetch("/api/me").then(function (r) {
    if (!r.res.ok) { PL.showToast(r.data.error || "লোড করা যায়নি।", "bad"); return; }
    applyMe(r.data);
  }).catch(function () { PL.showToast("নেটওয়ার্ক সমস্যা।", "bad"); });
})();
