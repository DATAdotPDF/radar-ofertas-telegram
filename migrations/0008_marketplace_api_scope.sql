-- Escopo final: Mercado Livre e Amazon por APIs oficiais.

ALTER TABLE watch_rules ADD COLUMN min_discount_percent INTEGER NOT NULL DEFAULT 5;
ALTER TABLE offer_observations ADD COLUMN original_price_cents INTEGER;
ALTER TABLE offer_observations ADD COLUMN discount_percent INTEGER;

UPDATE source_configs
SET status = CASE
      WHEN EXISTS (SELECT 1 FROM provider_oauth_tokens WHERE provider = 'mercado_livre') THEN 'active'
      ELSE 'pending'
    END,
    kind = 'api',
    notes = 'Busca automática pela API oficial. Links afiliados exigem ferramenta oficial do programa; a API pública não documenta conversão automática.',
    updated_at = datetime('now')
WHERE id = 'mercado-livre' AND tenant_id = 'default';

UPDATE source_configs
SET status = 'pending',
    kind = 'api',
    policy_url = 'https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding',
    search_url_template = 'https://creatorsapi.amazon/catalog/v1/searchItems',
    image_authorized = 1,
    notes = 'Amazon Creators API. Ativa automaticamente quando as credenciais e a tag do associado estiverem configuradas.',
    updated_at = datetime('now')
WHERE id = 'amazon-br' AND tenant_id = 'default';

UPDATE source_configs
SET status = 'paused',
    notes = 'Fora do escopo atual. O Radar usa somente Mercado Livre e Amazon por API.'
WHERE id NOT IN ('mercado-livre', 'amazon-br') AND tenant_id = 'default';

DELETE FROM source_configs
WHERE id NOT IN ('mercado-livre', 'amazon-br')
  AND tenant_id = 'default'
  AND NOT EXISTS (SELECT 1 FROM offers WHERE offers.source_id = source_configs.id)
  AND NOT EXISTS (SELECT 1 FROM collector_runs WHERE collector_runs.source_id = source_configs.id);
