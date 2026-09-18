-- Catálogo completo. Uma fonte só entra no cron após API, feed ou permissão registrada.

ALTER TABLE source_configs ADD COLUMN notes TEXT;

UPDATE source_configs
SET name = 'ShopB',
    notes = 'HTML público somente após revisão de termos e robots.txt.'
WHERE id = 'shopb';

UPDATE source_configs
SET notes = CASE id
  WHEN 'mercado-livre' THEN 'API oficial OAuth conectada. Busca horária ativa.'
  WHEN 'olx' THEN 'Sem coleta automática. Exige autorização formal ou fonte licenciada.'
  WHEN 'amazon-br' THEN 'Exige aprovação da Creators API e Partner Tag.'
  WHEN 'shopee' THEN 'Exige acesso aprovado à API ou feed de parceiro.'
  ELSE 'Aguardar API, feed autorizado ou revisão documentada de termos e robots.txt.'
END
WHERE notes IS NULL;

INSERT OR IGNORE INTO source_configs (id, tenant_id, name, kind, status, policy_url, notes) VALUES
  ('carrefour', 'default', 'Carrefour', 'html', 'pending', NULL, 'HTML público somente após revisão de termos e robots.txt.'),
  ('aliexpress-br', 'default', 'AliExpress Brasil', 'api', 'pending', 'https://portals.aliexpress.com/', 'Exige acesso aprovado a programa de parceiros ou API.'),
  ('eneba', 'default', 'Eneba', 'api', 'pending', NULL, 'Exige integração autorizada, programa de afiliados ou feed permitido.'),
  ('meu-game-usado', 'default', 'MeuGameUsado', 'html', 'pending', NULL, 'HTML público somente após revisão de termos e robots.txt.'),
  ('pelando', 'default', 'Pelando', 'manual', 'pending', NULL, 'Somente parceria, feed permitido ou conteúdo encaminhado pelo administrador.'),
  ('promobit', 'default', 'Promobit', 'manual', 'pending', NULL, 'Somente parceria, feed permitido ou conteúdo encaminhado pelo administrador.'),
  ('nintendrops', 'default', 'NintenDrops', 'manual', 'pending', NULL, 'Referência de formato. Sem coleta automática; exige parceria ou conteúdo encaminhado.'),
  ('nintendo-barato', 'default', 'Nintendo Barato', 'manual', 'pending', NULL, 'Somente parceria, feed permitido ou conteúdo encaminhado pelo administrador.');

UPDATE source_configs
SET status = 'blocked',
    notes = 'Sem coleta automática. Exige autorização formal ou fonte licenciada.'
WHERE id = 'olx';
