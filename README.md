# PayLink — TMA edition

Telegram Mini App + Cloudflare Workers + D1. **No admin panel, no signup, no login.**
Every Telegram user is automatically a merchant: they set their own bKash / Nagad / Rocket / Upay
number, switch each method on or off, and get an API key and an SMS token. Customers pay
**straight to the merchant's own number** (no balance, no payouts, no platform fee).

Identity is Telegram's signed `initData`, verified on the server with your bot token — so "anyone can
set their number" is safe: a person can only ever change *their own* account.

## Setup

```bash
npm install
npx wrangler d1 create paylink-db            # paste the database_id into wrangler.toml
npm run db:apply:remote                       # use a NEW database — the schema differs from v2
npx wrangler secret put BOT_TOKEN             # your Telegram bot token (from @BotFather)
npm run deploy
```

In **@BotFather** → your bot → *Bot Settings → Menu Button* (or *Configure Mini App*) → set the URL to your
Worker URL (e.g. `https://paylink.<you>.workers.dev/`). Open the bot → the Mini App.

## SMS app (APK)

এই রিপোতে APK-এর কোড নেই। আগে থেকে বানানো অ্যাপটির লিংক `wrangler.toml`-এর `APK_URL`-এ দেওয়া আছে
(`https://github.com/lagadev/uglypayapk/releases/download/v1.0.0/app-debug.apk`) — Mini App-এর **APK ডাউনলোড** বাটন সেটাই খোলে।

অ্যাপটিকে সার্ভারে এভাবে পাঠাতে হবে: `POST <Server URL>/api/sms/ingest`, হেডার `Authorization: Bearer <SMS Token>`,
বডি `{ "sender": "bKash", "body": "<পুরো SMS>", "receivedAt": <ms> }` (অথবা পার্স করা `{ trxId, amount, method, senderNumber }`).

## API (for merchants' own sites/bots)

`POST /api/invoices` with `Authorization: Bearer <API key>` and `{ "amount": 500, "reference": "o1", "callbackUrl": "https://…" }`
→ `{ id, payUrl, … }`. On verification a signed webhook is sent (`X-Signature` = HMAC-SHA256 of the body
with the merchant's API key). See `/docs.html`.

## Notes

- `parseSms` is written from typical operator wording; test it with real messages from your wallets
  and adjust the regexes if an operator's format differs.
- An SMS can only verify invoices of the merchant whose token uploaded it.
- Rotating a key/token in the Mini App invalidates the old one immediately.
