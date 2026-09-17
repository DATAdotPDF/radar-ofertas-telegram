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
  return rule.name;
}

function asCents(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

async function mercadoLivre(source: SourceConfig, rules: WatchRule[]): Promise<SourceOffer[]> {
  const mapped: SourceOffer[] = [];
  for (const rule of rules) {
    const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(queryFor(rule))}&limit=20&sort=price_asc`, {
      headers: { "Accept": "application/json" }
    });
    if (!response.ok) throw new Error(`API Mercado Livre retornou ${response.status}`);
    const data = await response.json() as { results?: Array<Record<string, unknown>> };
    const offers = await Promise.all((data.results ?? []).map(async (item): Promise<SourceOffer | null> => {
      const priceCents = asCents(item.price);
      const permalink = typeof item.permalink === "string" ? item.permalink : null;
      const externalId = typeof item.id === "string" ? item.id : null;
      const title = typeof item.title === "string" ? item.title : null;
      if (!priceCents || !permalink || !externalId || !title) return null;
      const seller = item.seller as Record<string, unknown> | undefined;
      const condition = item.condition === "used" ? "used" : "new";
      const description = condition === "used" ? await mercadoLivreDescription(externalId) : undefined;
      return {
        sourceId: source.id,
        externalId,
        title,
        description,
        url: permalink,
        imageUrl: typeof item.thumbnail === "string" ? item.thumbnail : undefined,
        imageAuthorized: Boolean(source.image_authorized),
        sellerName: typeof item.official_store_name === "string" ? item.official_store_name : undefined,
        sellerReputation: sellerReputationScore(seller),
        officialStore: Boolean(item.official_store_id),
        condition,
        priceCents,
        shippingText: (item.shipping as { free_shipping?: boolean } | undefined)?.free_shipping ? "frete grátis" : undefined,
        stockStatus: "in_stock",
        warranty: typeof item.warranty === "string" && item.warranty.length > 0
      };
    }));
    mapped.push(...offers.filter((offer): offer is SourceOffer => offer !== null));
  }
  return [...new Map(mapped.map((offer) => [`${offer.sourceId}:${offer.externalId}`, offer])).values()];
}

function sellerReputationScore(seller: Record<string, unknown> | undefined): number | undefined {
  const reputation = seller?.seller_reputation as Record<string, unknown> | undefined;
  const level = reputation?.level_id;
  const scores: Record<string, number> = {
    "5_green": 100,
    "4_light_green": 90,
    "3_yellow": 70,
    "2_orange": 50,
    "1_red": 30
  };
  return typeof level === "string" ? scores[level] : undefined;
}

async function mercadoLivreDescription(itemId: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/description`);
    if (!response.ok) return undefined;
    const data = await response.json() as { plain_text?: unknown };
    return typeof data.plain_text === "string" ? data.plain_text : undefined;
  } catch {
    return undefined;
  }
}

export async function scanAllowedSources(env: Env, rules: WatchRule[]): Promise<ScanResult[]> {
  const sources = await activeSources(env);
  const results: ScanResult[] = [];
  for (const source of sources) {
    try {
      if (source.id === "mercado-livre") {
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
