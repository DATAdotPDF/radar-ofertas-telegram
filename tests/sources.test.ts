import { describe, expect, it } from "vitest";
import { shouldBlockSource, sourceQueries } from "../src/sources";
import type { WatchRule } from "../src/types";

const rule: WatchRule = {
  id: "switch2", tenant_id: "default", name: "Console Switch 2 e bundles", include_terms_json: '["nintendo switch 2", "switch 2 bundle", "nintendo switch 2"]',
  exclude_terms_json: "[]", category: "console", condition_scope: "new,used", max_price_cents: null,
  min_used_score: 70, alert_limit: 3, is_paused: 0, deleted_at: null
};

describe("consultas das fontes", () => {
  it("pesquisa os termos da régua, sem repetir consultas", () => {
    expect(sourceQueries(rule)).toEqual(["nintendo switch 2", "switch 2 bundle"]);
  });

  it("usa o nome da régua se o histórico de termos estiver inválido", () => {
    expect(sourceQueries({ ...rule, include_terms_json: "{" })).toEqual([rule.name]);
  });

  it("bloqueia uma fonte que recusa ou limita requisições", () => {
    expect(shouldBlockSource("API retornou 403")).toBe(true);
    expect(shouldBlockSource("API retornou 429")).toBe(true);
    expect(shouldBlockSource("erro de rede")).toBe(false);
  });
});
