import { describe, expect, it } from "vitest";
import { assessUsedOffer, evaluateTriggers, matchesRule, shouldRepeatAlert } from "../src/scoring";
import type { SourceOffer, WatchRule } from "../src/types";

const rule: WatchRule = {
  id: "rule", tenant_id: "default", name: "Switch 2", include_terms_json: '["switch 2", "joy-con 2"]', exclude_terms_json: '["caixa"]',
  category: "console", condition_scope: "new,used", max_price_cents: 300000, min_used_score: 70, alert_limit: 3, is_paused: 0, deleted_at: null
};

const usedOffer: SourceOffer = {
  sourceId: "ml", externalId: "a1", title: "Nintendo Switch 2 seminovo", description: "Console muito bem conservado, com nota fiscal, garantia vigente, todos os cabos originais, base e controles. Sem marcas relevantes e funcionando perfeitamente.",
  url: "https://example.test/a1", imageUrl: "https://example.test/a1.jpg", condition: "used", priceCents: 250000,
  sellerReputation: 92, warranty: true, invoice: true
};

describe("filtro e ranking", () => {
  it("aceita usado bem descrito com nota mínima", () => {
    const assessment = assessUsedOffer(usedOffer, 300000);
    expect(assessment.accepted).toBe(true);
    expect(assessment.score).toBeGreaterThanOrEqual(70);
  });

  it("bloqueia defeito e não envia usado sem foto", () => {
    expect(assessUsedOffer({ ...usedOffer, description: `${usedOffer.description} possui defeito` }, 300000).accepted).toBe(false);
    expect(assessUsedOffer({ ...usedOffer, imageUrl: undefined }, 300000).accepted).toBe(false);
  });

  it("leva preço muito abaixo da referência para quarentena", () => {
    const result = assessUsedOffer({ ...usedOffer, priceCents: 100000 }, 300000);
    expect(result.quarantineReason).toContain("40%");
  });

  it("não mistura termo excluído e reconhece termos da régua", () => {
    expect(matchesRule(usedOffer, rule)).toBe(true);
    expect(matchesRule({ ...usedOffer, title: "Caixa Nintendo Switch 2" }, rule)).toBe(false);
  });

  it("dispara queda, teto, mediana e novo menor preço", () => {
    const assessment = assessUsedOffer(usedOffer, 300000);
    const result = evaluateTriggers(usedOffer, rule, {
      previousPriceCents: 280000, median30Cents: 300000, comparableItems: 5, comparableSources: 2,
      historicalMinimumCents: 260000, historicalSamples: 4
    }, assessment);
    expect(result.triggers).toEqual(expect.arrayContaining(["target_price", "price_drop", "below_median", "new_low", "quality_used"]));
  });

  it("só repete alerta dentro de 24 horas com nova queda de 5%", () => {
    const now = Date.now();
    expect(shouldRepeatAlert(100000, new Date(now - 60_000).toISOString(), 98000, now)).toBe(false);
    expect(shouldRepeatAlert(100000, new Date(now - 60_000).toISOString(), 95000, now)).toBe(true);
    expect(shouldRepeatAlert(100000, new Date(now - 25 * 60 * 60 * 1000).toISOString(), 99000, now)).toBe(true);
  });
});
