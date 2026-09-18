import { describe, expect, it } from "vitest";
import { offerAlertText } from "../src/telegram";
import type { AlertCandidate } from "../src/types";

const candidate: AlertCandidate = {
  rule: { id: "r", tenant_id: "default", name: "Switch 2", include_terms_json: "[]", exclude_terms_json: "[]", category: "console", condition_scope: "new", max_price_cents: null, min_used_score: 70, alert_limit: 3, min_discount_percent: 5, is_paused: 0, deleted_at: null },
  offer: { id: "o", canonicalKey: "console:switch", firstSeenAt: "2026-09-18T00:00:00Z", lastSeenAt: "2026-09-18T00:00:00Z", sourceId: "mercado-livre", externalId: "MLB1", title: "Nintendo Switch 2", description: "Console lacrado com garantia de fábrica e envio imediato.", url: "https://example.test/item", priceCents: 299900, originalPriceCents: 349900, discountPercent: 14, pixPriceCents: 289900, couponText: "RADAR10", shippingText: "frete grátis", condition: "new" },
  triggers: ["target_price"], reasons: ["abaixo do teto"], score: 90, used: { score: 100, accepted: true, reasons: [] }
};

describe("alerta do Telegram", () => {
  it("entrega o formato curto de promoção", () => {
    const text = offerAlertText(candidate);
    expect(text).toContain("[Mercado Livre] Nintendo Switch 2");
    expect(text).toContain("Cupom: <b>RADAR10</b>");
    expect(text).toContain("PIX: <b>R$");
    expect(text).toContain("Frete: frete grátis");
    expect(text).toContain("Desconto: <b>14%</b>");
    expect(text).toContain("Motivo: abaixo do teto");
  });
});
