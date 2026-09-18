-- Rastreadores de jogos digitais Nintendo para o Brasil.
-- Permanecem pendentes até haver uma via permitida de coleta.

INSERT OR IGNORE INTO source_configs (id, tenant_id, name, kind, status, policy_url, notes) VALUES
  ('nintendo-eshop-deals', 'default', 'Nintendo eShop — Ofertas oficiais', 'html', 'pending', 'https://www.nintendo.com/pt-br/store/sales-and-deals/', 'Fonte oficial de promoções digitais. Ativar somente após revisão de termos e robots.txt.'),
  ('nt-deals', 'default', 'NT Deals Brasil', 'html', 'pending', 'https://ntdeals.net/br-store', 'Rastreador de preços Nintendo com região Brasil e Switch 2. Exige revisão de termos, robots.txt ou feed permitido.'),
  ('psprices-br', 'default', 'PSPrices Brasil', 'html', 'pending', 'https://psprices.com/region-br/index?lang=pt', 'Rastreador com descontos e mínimo histórico para Switch e Switch 2. Exige revisão de termos, robots.txt ou feed permitido.');
