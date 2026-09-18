-- Deixa o radar reutilizável e mantém recusas temporárias como pausa revisável.

UPDATE watch_rules
SET is_paused = 0,
    updated_at = datetime('now')
WHERE id = 'switch2-digital' AND tenant_id = 'default';

UPDATE source_configs
SET status = 'paused',
    notes = 'OAuth configurado. Pausada após resposta 403 da API; reativar quando o acesso de busca for liberado.',
    updated_at = datetime('now')
WHERE id = 'mercado-livre' AND tenant_id = 'default' AND status = 'blocked';

UPDATE source_configs
SET status = 'pending',
    notes = CASE id
      WHEN 'olx' THEN 'Aguardando autorização formal, API ou fonte licenciada. O conector permanece preparado.'
      WHEN 'nt-deals' THEN 'Aguardando feed, API ou validação do acesso automatizado. O site apresentou desafio anti-bot.'
      WHEN 'psprices-br' THEN 'Aguardando feed, API ou validação do acesso automatizado. O site apresentou desafio anti-bot.'
      WHEN 'nintendo-eshop-deals' THEN 'Referência oficial manual. A coleta exige autorização escrita ou feed oficial.'
      ELSE notes
    END,
    updated_at = datetime('now')
WHERE id IN ('olx', 'nt-deals', 'psprices-br', 'nintendo-eshop-deals') AND tenant_id = 'default';

INSERT OR IGNORE INTO source_configs
  (id, tenant_id, name, kind, status, policy_url, search_url_template, image_authorized, notes)
VALUES
  ('authorized-json-feed', 'default', 'Feed JSON autorizado', 'api', 'pending', NULL, NULL, 0,
   'Modelo para APIs e feeds autorizados. Defina a URL, libere o host e altere o estado para active.');
