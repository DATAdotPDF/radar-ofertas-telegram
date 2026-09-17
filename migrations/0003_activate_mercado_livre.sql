-- Mercado Livre is the first permitted automatic source, through its documented API.
UPDATE source_configs
SET status = 'active',
    search_url_template = 'https://api.mercadolibre.com/sites/MLB/search?q={query}',
    updated_at = datetime('now')
WHERE id = 'mercado-livre' AND tenant_id = 'default';
