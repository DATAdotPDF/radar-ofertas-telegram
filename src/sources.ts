import { amazonConfigurationState, amazonSearch } from "./amazon";
import { activeSources, sourceOutcome } from "./db";
import { meliAccessToken, meliOAuthState } from "./meli";
import type { Env, SourceConfig, SourceOffer, WatchRule } from "./types";

export interface ScanResult {
  sourceId: string;
  offers: SourceOffer[];
  ok: boolean;
  error?: string;
}

export function sourceQueries(rule: WatchRule): string[] {
  try {
    const terms = JSON.parse(rule.include_terms_json) as unknown;
    if (Array.isArray(terms)) {
      const unique = [...new Set(terms
        .filter((term): term is string => typeof term === "string")
        .map((term) => term.trim())
        .filter(Boolean))];
      if (unique.length) return unique.slice(0, 6);
    }
  } catch {
    // Usa o nome da régua se os termos salvos estiverem inválidos.
  }
  return [rule.name];
}

export function scanQueries(rules: WatchRule[], limit = 12): string[] {
  return [...new Set(rules.flatMap(sourceQueries))].slice(0, limit);
}

export function shouldPauseSource(error: string): boolean {
  return /\b(?:401|403|429)\b/.test(error);
}

function asCents(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

function advertisedDiscount(priceCents: number, originalPriceCents: number | null): number | undefined {
  if (!originalPriceCents || originalPriceCents <= priceCents) return undefined;
  return Math.round(((originalPriceCents - priceCents) / originalPriceCents) * 100);
}

function sellerReputationScore(seller: Record<string, unknown> | undefined): number | undefined {
  const reputation = seller?.seller_reputation as Record<string, unknown> | undefined;
  const level = reputation?.level_id ?? seller?.reputation_level_id;
  const scores: Record<string, number> = {
    "5_green": 100,
    "4_light_green": 90,
    "3_yellow": 70,
    "2_orange": 50,
    "1_red": 30,
    "GREEN": 100
  };
  return typeof level === "string" ? scores[level] : undefined;
}

async function mercadoLivreDescription(itemId: string, accessToken: string): Promise<string | undefined> {
  try {
    const response = await fetch(`https://api.mercadolibre.com/items/${encodeURIComponent(itemId)}/description`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return undefined;
    const data = await response.json() as { plain_text?: unknown };
    return typeof data.plain_text === "string" ? data.plain_text : undefined;
  } catch {
    return undefined;
  }
}

async function mapListing(source: SourceConfig, item: Record<string, unknown>, accessToken: string): Promise<SourceOffer | null> {
  const priceCents = asCents(item.price);
  const originalPriceCents = asCents(item.original_price);
  const permalink = typeof item.permalink === "string" ? item.permalink : null;
  const externalId = typeof item.id === "string" ? item.id : null;
  const title = typeof item.title === "string" ? item.title : null;
  if (!priceCents || !permalink || !externalId || !title) return null;
  const seller = item.seller as Record<string, unknown> | undefined;
  const itemCondition = item.condition === "used" ? "used" : "new";
  return {
    sourceId: source.id,
    externalId,
    title,
    description: itemCondition === "used" ? await mercadoLivreDescription(externalId, accessToken) : undefined,
    url: permalink,
    imageUrl: typeof item.thumbnail === "string" ? item.thumbnail : undefined,
    imageAuthorized: Boolean(source.image_authorized),
    sellerName: typeof item.official_store_name === "string" ? item.official_store_name : undefined,
    sellerReputation: sellerReputationScore(seller),
    officialStore: Boolean(item.official_store_id),
    condition: itemCondition,
    priceCents,
    originalPriceCents: originalPriceCents ?? undefined,
    discountPercent: advertisedDiscount(priceCents, originalPriceCents),
    shippingText: (item.shipping as { free_shipping?: boolean } | undefined)?.free_shipping ? "frete grátis" : undefined,
    stockStatus: "in_stock",
    warranty: typeof item.warranty === "string" && item.warranty.length > 0
  };
}

async function mercadoLivreListingSearch(source: SourceConfig, query: string, accessToken: string): Promise<SourceOffer[]> {
  const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(query)}&limit=20&sort=price_asc`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`LISTING_SEARCH_${response.status}`);
  const data = await response.json() as { results?: Array<Record<string, unknown>> };
  const offers = await Promise.all((data.results ?? []).map((item) => mapListing(source, item, accessToken)));
  return offers.filter((offer): offer is SourceOffer => offer !== null);
}

export function mapMeliCatalogProduct(source: SourceConfig, product: Record<string, any>): SourceOffer | null {
  const winner = product.buy_box_winner as Record<string, any> | null | undefined;
  if (!winner) return null;
  const priceCents = asCents(winner?.price);
  const originalPriceCents = asCents(winner?.original_price);
  const externalId = typeof winner?.item_id === "string" ? winner.item_id : null;
  const title = typeof product.name === "string" ? product.name : null;
  const url = typeof product.permalink === "string" ? product.permalink : null;
  if (!priceCents || !externalId || !title || !url) return null;
  const imageUrl = Array.isArray(product.pictures) && typeof product.pictures[0]?.url === "string" ? product.pictures[0].url : undefined;
  return {
    sourceId: source.id,
    externalId,
    title,
    url,
    imageUrl,
    imageAuthorized: Boolean(source.image_authorized),
    sellerName: winner.seller_id ? `Vendedor ${winner.seller_id}` : undefined,
    sellerReputation: sellerReputationScore(winner.seller),
    condition: "new",
    priceCents,
    originalPriceCents: originalPriceCents ?? undefined,
    discountPercent: advertisedDiscount(priceCents, originalPriceCents),
    shippingText: winner.shipping?.free_shipping ? "frete grátis" : undefined,
    stockStatus: "in_stock"
  };
}

async function mercadoLivreCatalogSearch(source: SourceConfig, query: string, accessToken: string): Promise<SourceOffer[]> {
  const response = await fetch(`https://api.mercadolibre.com/products/search?status=active&site_id=MLB&q=${encodeURIComponent(query)}&limit=5`, {
    headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`API Mercado Livre retornou ${response.status}`);
  const data = await response.json() as { results?: Array<{ id?: unknown }> };
  const ids = (data.results ?? []).map((value) => value.id).filter((value): value is string => typeof value === "string");
  const products = await Promise.all(ids.map(async (id) => {
    const detail = await fetch(`https://api.mercadolibre.com/products/${encodeURIComponent(id)}`, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}` }
    });
    return detail.ok ? detail.json() as Promise<Record<string, any>> : null;
  }));
  return products.map((product) => product ? mapMeliCatalogProduct(source, product) : null).filter((offer): offer is SourceOffer => offer !== null);
}

async function mercadoLivre(env: Env, source: SourceConfig, queries: string[]): Promise<SourceOffer[]> {
  const accessToken = await meliAccessToken(env);
  const mapped: SourceOffer[] = [];
  for (const query of queries) {
    try {
      mapped.push(...await mercadoLivreListingSearch(source, query, accessToken));
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "LISTING_SEARCH_403") throw error;
      mapped.push(...await mercadoLivreCatalogSearch(source, query, accessToken));
    }
  }
  return [...new Map(mapped.map((offer) => [`${offer.sourceId}:${offer.externalId}`, offer])).values()];
}

async function activateConfiguredSources(env: Env): Promise<void> {
  const meli = await meliOAuthState(env);
  if (meli === "authorized") {
    await env.DB.prepare("UPDATE source_configs SET status='active', last_error=NULL WHERE id='mercado-livre' AND tenant_id='default' AND status='pending'").run();
  } else {
    await env.DB.prepare("UPDATE source_configs SET status='pending' WHERE id='mercado-livre' AND tenant_id='default' AND status='active'").run();
  }
  if (amazonConfigurationState(env) === "configured") {
    await env.DB.prepare("UPDATE source_configs SET status='active', last_error=NULL WHERE id='amazon-br' AND tenant_id='default' AND status='pending'").run();
  } else {
    await env.DB.prepare("UPDATE source_configs SET status='pending' WHERE id='amazon-br' AND tenant_id='default' AND status='active'").run();
  }
}

export async function scanAllowedSources(env: Env, rules: WatchRule[]): Promise<ScanResult[]> {
  await activateConfiguredSources(env);
  const sources = await activeSources(env);
  const queries = scanQueries(rules);
  const results: ScanResult[] = [];
  for (const source of sources) {
    try {
      const offers = source.id === "mercado-livre"
        ? await mercadoLivre(env, source, queries)
        : source.id === "amazon-br"
          ? await amazonSearch(env, source, queries)
          : [];
      await sourceOutcome(env, source.id, true);
      results.push({ sourceId: source.id, offers, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      await sourceOutcome(env, source.id, false, message, shouldPauseSource(message));
      results.push({ sourceId: source.id, offers: [], ok: false, error: message });
    }
  }
  return results;
}
