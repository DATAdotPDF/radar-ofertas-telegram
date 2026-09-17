import { activeSources, sourceOutcome } from "./db";
import type { Env, SourceConfig, SourceOffer, WatchRule } from "./types";

export interface ScanResult {
  sourceId: string;
  offers: SourceOffer[];
  ok: boolean;
  error?: string;
}

function urlFor(template: string, query: string): string | null {
  try {
    const url = new URL(template.replace("{query}", encodeURIComponent(query)));
    if (url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function queryFor(rule: WatchRule): string {
  try {
    const terms = JSON.parse(rule.include_terms_json) as string[];
    return terms[0] ?? rule.name;
  } catch {
    return rule.name;
  }
}

function asCents(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

async function mercadoLivre(source: SourceConfig, rules: WatchRule[]): Promise<SourceOffer[]> {
  const mapped: SourceOffer[] = [];
  for (const rule of rules) {
    const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(queryFor(rule))}&limit=20`, {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(`API Mercado Livre retornou ${response.status}`);
    const data = await response.json() as { results?: Array<Record<string, unknown>> };
    for (const item of data.results ?? []) {
      const priceCents = asCents(item.price);
      const permalink = typeof item.permalink === "string" ? item.permalink : null;
      const externalId = typeof item.id === "string" ? item.id : null;
      const title = typeof item.title === "string" ? item.title : null;
      if (!priceCents || !permalink || !externalId || !title) continue;
      const seller = item.seller as Record<string, unknown> | undefined;
      mapped.push({
        sourceId: source.id,
        externalId,
        title,
        url: permalink,
        imageUrl: typeof item.thumbnail === "string" ? item.thumbnail : undefined,
        imageAuthorized: Boolean(source.image_authorized),
        sellerName: typeof item.official_store_name === "string" ? item.official_store_name : undefined,
        sellerReputation: typeof seller?.seller_reputation === "number" ? seller.seller_reputation : undefined,
        officialStore: Boolean(item.official_store_id),
        condition: item.condition === "used" ? "used" : "new",
        priceCents,
        shippingText: (item.shipping as { free_shipping?: boolean } | undefined)?.free_shipping ? "frete grátis" : undefined,
        stockStatus: "in_stock"
      });
    }
  }
  return mapped;
}

export async function scanAllowedSources(env: Env, rules: WatchRule[]): Promise<ScanResult[]> {
  const sources = await activeSources(env);
  const results: ScanResult[] = [];
  for (const source of sources) {
    try {
      if (source.id === "mercadolivre") {
        const offers = await mercadoLivre(source, rules);
        await sourceOutcome(env, source.id, true);
        results.push({ sourceId: source.id, offers, ok: true });
      } else if (source.kind === "browser") {
        results.push({ sourceId: source.id, offers: [], ok: true, error: "delegada ao coletor autorizado" });
      } else {
        results.push({ sourceId: source.id, offers: [], ok: true, error: "sem adaptador aprovado" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      await sourceOutcome(env, source.id, false, message);
      results.push({ sourceId: source.id, offers: [], ok: false, error: message });
    }
  }
  return results;
}
