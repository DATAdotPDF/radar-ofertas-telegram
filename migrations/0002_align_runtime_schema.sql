-- Align the initial schema with the Worker runtime. Existing records are preserved.

ALTER TABLE telegram_users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE telegram_users ADD COLUMN session_state TEXT;

ALTER TABLE watch_rules ADD COLUMN condition_scope TEXT NOT NULL DEFAULT 'new,used,refurbished,unknown';
ALTER TABLE watch_rules ADD COLUMN min_used_score INTEGER NOT NULL DEFAULT 70;
ALTER TABLE watch_rules ADD COLUMN alert_limit INTEGER NOT NULL DEFAULT 3;
ALTER TABLE watch_rules ADD COLUMN is_paused INTEGER NOT NULL DEFAULT 0;
UPDATE watch_rules
SET condition_scope = CASE condition_filter
  WHEN 'new' THEN 'new'
  WHEN 'used' THEN 'used,refurbished'
  ELSE 'new,used,refurbished,unknown'
END,
is_paused = CASE WHEN active = 1 THEN 0 ELSE 1 END;

ALTER TABLE source_configs ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
UPDATE source_configs SET failure_count = consecutive_failures;

ALTER TABLE offers ADD COLUMN official_store INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offers ADD COLUMN trailer_url TEXT;
ALTER TABLE offers ADD COLUMN warranty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE offers ADD COLUMN invoice INTEGER NOT NULL DEFAULT 0;
UPDATE offers
SET official_store = is_official_store,
    warranty = has_warranty,
    invoice = has_receipt;

ALTER TABLE offer_observations ADD COLUMN installment_text TEXT;
ALTER TABLE offer_observations ADD COLUMN shipping_text TEXT;
ALTER TABLE offer_observations ADD COLUMN coupon_text TEXT;

ALTER TABLE alert_events ADD COLUMN rule_id TEXT;
ALTER TABLE alert_events ADD COLUMN destination TEXT;
ALTER TABLE alert_events ADD COLUMN telegram_message_id TEXT;
UPDATE alert_events SET rule_id = watch_rule_id WHERE rule_id IS NULL;

ALTER TABLE quarantined_offers ADD COLUMN rule_id TEXT;
ALTER TABLE quarantined_offers ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';
