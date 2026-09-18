import { describe, expect, it } from "vitest";
import { balancedScanQueries, mapMeliCatalogProduct, scanQueries, shouldPauseSource, sourceQueries } from "../src/sources";
import type { SourceConfig, WatchRule } from "../src/types";

const rule: WatchRule = {
  id: "switch2", tenant_id: "default", name: "Console Switch 2 e bundles", include_terms_json: '["nintendo switch 2", "switch 2 bundle", "nintendo switch 2"]',
  exclude_terms_json: "[]", category: "console", condition_scope: "new,used", max_price_cents: null,
  min_used_score: 70, alert_limit: 3, min_discount_percent: 5, is_paused: 0, deleted_at: null
};

const source: SourceConfig = {
  id: "mercado-livre", tenant_id: "default", name: "Mercado Livre", kind: "api", status: "active",
  policy_url: null, search_url_template: null, image_authorized: 0, notes: null
};

describe("consultas do Mercado Livre", () => {
  it("pesquisa os termos da régua sem repetir consultas", () => {
    expect(sourceQueries(rule)).toEqual(["nintendo switch 2", "switch 2 bundle"]);
    expect(scanQueries([rule, { ...rule, id: "2" }])).toEqual(["nintendo switch 2", "switch 2 bundle"]);
  });

  it("limita o total de pesquisas por execução", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({ ...rule, id: String(index), include_terms_json: `["produto ${index}"]` }));
    expect(scanQueries(many)).toHaveLength(12);
  });

  it("equilibra uma consulta por régua e alterna o termo a cada hora", () => {
    const rules = [
      rule,
      { ...rule, id: "games", include_terms_json: '["zelda", "mario"]' },
      { ...rule, id: "controles", include_terms_json: '["joy-con 2", "pro controller"]' }
    ];
    expect(balancedScanQueries(rules, 0)).toEqual(["nintendo switch 2", "zelda", "joy-con 2"]);
    expect(balancedScanQueries(rules, 1)).toEqual(["mario", "pro controller", "switch 2 bundle"]);
  });

  it("pausa uma fonte que recusa ou limita requisições", () => {
    expect(shouldPauseSource("API retornou 403")).toBe(true);
    expect(shouldPauseSource("API retornou 429")).toBe(true);
    expect(shouldPauseSource("erro de rede")).toBe(false);
  });

  it("normaliza a oferta vencedora do catálogo", () => {
    const offer = mapMeliCatalogProduct(source, {
      name: "Nintendo Switch 2",
      permalink: "https://www.mercadolivre.com.br/p/MLB123",
      pictures: [{ url: "https://http2.mlstatic.com/item.jpg" }],
      buy_box_winner: {
        item_id: "MLB999", price: 2699, original_price: 2999, seller_id: 123,
        shipping: { free_shipping: true }, seller: { reputation_level_id: "GREEN" }
      }
    });
    expect(offer).toMatchObject({ externalId: "MLB999", priceCents: 269900, originalPriceCents: 299900, discountPercent: 10, sellerReputation: 100 });
  });
});
