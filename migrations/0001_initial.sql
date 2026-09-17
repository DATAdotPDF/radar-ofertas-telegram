PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS telegram_users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  telegram_user_id TEXT NOT NULL UNIQUE,
  chat_id TEXT,
  role TEXT NOT NULL DEFAULT 'subscriber' CHECK(role IN ('owner', 'admin', 'subscriber')),
  pending_action TEXT,
  draft_json TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS destinations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  chat_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('private', 'group', 'channel')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(tenant_id, chat_id)
);

CREATE TABLE IF NOT EXISTS watch_rules (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  include_terms_json TEXT NOT NULL,
  exclude_terms_json TEXT NOT NULL DEFAULT '[]',
  condition_filter TEXT NOT NULL DEFAULT 'both' CHECK(condition_filter IN ('new', 'used', 'both')),
  max_price_cents INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_configs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('api', 'html', 'browser', 'manual')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'allowed', 'active', 'paused', 'blocked')),
  search_url_template TEXT,
  policy_url TEXT,
  image_authorized INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  last_error TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS offers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_id TEXT NOT NULL REFERENCES source_configs(id),
  external_id TEXT NOT NULL,
  canonical_key TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL,
  image_url TEXT,
  image_authorized INTEGER NOT NULL DEFAULT 0,
  seller_name TEXT,
  seller_reputation INTEGER,
  is_official_store INTEGER NOT NULL DEFAULT 0,
  condition TEXT NOT NULL DEFAULT 'unknown' CHECK(condition IN ('new', 'used', 'refurbished', 'unknown')),
  has_warranty INTEGER NOT NULL DEFAULT 0,
  has_receipt INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS offer_observations (
  id TEXT PRIMARY KEY,
  offer_id TEXT NOT NULL REFERENCES offers(id),
  price_cents INTEGER NOT NULL,
  pix_price_cents INTEGER,
  cash_price_cents INTEGER,
  installment_count INTEGER,
  installment_cents INTEGER,
  shipping_cents INTEGER,
  stock_status TEXT NOT NULL DEFAULT 'unknown',
  observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_observations_offer_time ON offer_observations(offer_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_offers_canonical ON offers(tenant_id, canonical_key, condition);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  offer_id TEXT NOT NULL REFERENCES offers(id),
  watch_rule_id TEXT NOT NULL REFERENCES watch_rules(id),
  trigger_type TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  sent_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(offer_id, watch_rule_id, trigger_type, price_cents)
);

CREATE TABLE IF NOT EXISTS quarantined_offers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  offer_id TEXT NOT NULL REFERENCES offers(id),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(offer_id, reason)
);

CREATE TABLE IF NOT EXISTS collector_runs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  source_id TEXT REFERENCES source_configs(id),
  status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed', 'skipped')),
  offers_received INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_cache (
  content_hash TEXT PRIMARY KEY,
  analysis_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO tenants(id, name) VALUES ('default', 'Radar de Ofertas');

INSERT OR IGNORE INTO watch_rules(id, tenant_id, name, category, include_terms_json, exclude_terms_json, condition_filter, active)
VALUES
  ('switch2-console', 'default', 'Console Switch 2 e bundles', 'console', '["nintendo switch 2", "switch 2 bundle"]', '["conta", "somente caixa", "peças", "conserto"]', 'both', 1),
  ('switch2-physical', 'default', 'Jogos físicos, pré-venda e colecionador', 'game', '["switch 2 mídia física", "switch 2 pré-venda", "switch 2 edição de colecionador", "switch 2 steelbook", "switch 2 capa foil"]', '["conta", "digital", "aluguel", "somente caixa"]', 'both', 1),
  ('switch2-accessories', 'default', 'Controles e acessórios Switch 2', 'accessory', '["joy-con 2", "controle pro switch 2", "câmera switch 2", "base switch 2", "micro sd express", "bolsa switch 2"]', '["conta", "peças", "conserto"]', 'both', 1),
  ('switch2-digital', 'default', 'Jogos digitais Switch 2', 'digital-game', '["switch 2 digital", "nintendo eshop switch 2"]', '["conta", "aluguel"]', 'new', 0);

INSERT OR IGNORE INTO source_configs(id, tenant_id, name, kind, status, policy_url) VALUES
  ('nintendo-br', 'default', 'Nintendo Brasil', 'html', 'pending', 'https://www.nintendo.com/pt-br/'),
  ('mercado-livre', 'default', 'Mercado Livre', 'api', 'pending', 'https://developers.mercadolivre.com.br/pt_br/termos-e-condicoes'),
  ('amazon-br', 'default', 'Amazon Brasil', 'api', 'pending', 'https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding'),
  ('kabum', 'default', 'KaBuM!', 'html', 'pending', NULL),
  ('magalu', 'default', 'Magazine Luiza', 'html', 'pending', NULL),
  ('fast-shop', 'default', 'Fast Shop', 'html', 'pending', NULL),
  ('casas-bahia', 'default', 'Casas Bahia', 'html', 'pending', NULL),
  ('ponto', 'default', 'Ponto', 'html', 'pending', NULL),
  ('americanas', 'default', 'Americanas', 'html', 'pending', NULL),
  ('gamer-hut', 'default', 'Gamer Hut', 'html', 'pending', NULL),
  ('tk-fortini', 'default', 'TK Fortini Games', 'html', 'pending', NULL),
  ('shopb', 'default', 'ShopB e MeuGameUsado', 'html', 'pending', NULL),
  ('shopee', 'default', 'Shopee Brasil', 'browser', 'pending', NULL),
  ('olx', 'default', 'OLX', 'manual', 'pending', 'https://ajuda.olx.com.br/public/Termos_e_Condicoes_de_Uso_OLX_27022025_727855f932.pdf'),
  ('zoom', 'default', 'Zoom', 'html', 'pending', NULL),
  ('buscape', 'default', 'Buscapé', 'html', 'pending', NULL),
  ('gamehunter', 'default', 'GameHunter', 'html', 'pending', NULL),
  ('setupbarato', 'default', 'SetupBarato', 'html', 'pending', NULL);
