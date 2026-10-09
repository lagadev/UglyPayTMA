-- ============================================================================
-- PayLink (TMA edition) — D1 schema.  Fresh database only:
--   wrangler d1 create paylink-db
--   wrangler d1 execute paylink-db --remote --file=./database/schema.sql
-- No admin, no passwords, no balances: each Telegram user is a merchant and
-- the customer pays straight to that merchant's own number.
-- ============================================================================

CREATE TABLE IF NOT EXISTS merchants (
  id            TEXT PRIMARY KEY,
  tg_id         INTEGER NOT NULL UNIQUE,      -- Telegram user id (from verified initData)
  display_name  TEXT NOT NULL,
  username      TEXT,
  api_key       TEXT NOT NULL UNIQUE,         -- create invoices from your site / bot
  ingest_token  TEXT NOT NULL UNIQUE,         -- only for the SMS app
  bkash_number  TEXT, bkash_enabled  INTEGER NOT NULL DEFAULT 0,
  nagad_number  TEXT, nagad_enabled  INTEGER NOT NULL DEFAULT 0,
  rocket_number TEXT, rocket_enabled INTEGER NOT NULL DEFAULT 0,
  upay_number   TEXT, upay_enabled   INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invoices (
  id              TEXT PRIMARY KEY,
  merchant_id     TEXT NOT NULL REFERENCES merchants(id),
  reference       TEXT,
  amount          REAL NOT NULL,
  method          TEXT,
  merchant_number TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | verified | expired
  verified_by     TEXT,
  trx_id          TEXT,
  sender_number   TEXT,
  callback_url    TEXT,
  created_at      INTEGER NOT NULL,
  expires_at      INTEGER NOT NULL,
  verified_at     INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invoices_merchant ON invoices(merchant_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_trx ON invoices(trx_id);

CREATE TABLE IF NOT EXISTS sms_transactions (
  id                 TEXT PRIMARY KEY,
  merchant_id        TEXT NOT NULL REFERENCES merchants(id),
  trx_id             TEXT NOT NULL,
  amount             REAL NOT NULL,
  sender_number      TEXT,
  method             TEXT NOT NULL,
  received_at        INTEGER NOT NULL,
  raw_sms            TEXT,
  matched_invoice_id TEXT REFERENCES invoices(id),
  created_at         INTEGER NOT NULL,
  UNIQUE(merchant_id, trx_id, method)
);
CREATE INDEX IF NOT EXISTS idx_sms_trx ON sms_transactions(trx_id);
