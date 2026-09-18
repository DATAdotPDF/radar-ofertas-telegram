import { describe, expect, it } from "vitest";
import { authorizedFeedUrl, parseAuthorizedFeed, shouldPauseSource, sourceQueries } from "../src/sources";
import type { SourceConfig, WatchRule } from "../src/types";

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

  it("pausa uma fonte que recusa ou limita requisições", () => {
    expect(shouldPauseSource("API retornou 403")).toBe(true);
    expect(shouldPauseSource("API retornou 429")).toBe(true);
    expect(shouldPauseSource("erro de rede")).toBe(false);
  });

  it("aceita apenas HTTPS em hosts liberados", () => {
    const env = { AUTHORIZED_FEED_HOSTS: "feeds.example.com" };
    expect(authorizedFeedUrl(env, "https://feeds.example.com/ofertas?q=switch")).not.toBeNull();
    expect(authorizedFeedUrl(env, "https://outro.example.com/ofertas")).toBeNull();
    expect(authorizedFeedUrl(env, "http://feeds.example.com/ofertas")).toBeNull();
  });

  it("valida e normaliza ofertas de um feed autorizado", () => {
    const source: SourceConfig = {
      id: "feed-parceiro", tenant_id: "default", name: "Feed parceiro", kind: "api", status: "active",
      policy_url: null, search_url_template: null, image_authorized: 1, notes: null
    };
    const offers = parseAuthorizedFeed(source, { offers: [{
      externalId: "abc", title: "Nintendo Switch 2", url: "https://loja.example.com/abc",
      imageUrl: "https://loja.example.com/abc.jpg", imageAuthorized: true, priceCents: 249900, condition: "new"
    }, { title: "incompleta" }] });
    expect(offers).toHaveLength(1);
    expect(offers[0]).toMatchObject({ sourceId: "feed-parceiro", externalId: "abc", priceCents: 249900, imageAuthorized: true });
  });
});
