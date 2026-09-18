import { activeSources, sourceOutcome } from "./db";
import { meliAccessToken } from "./meli";
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

export function sourceQueries(rule: WatchRule): string[] {
  try {
    const terms = JSON.parse(rule.include_terms_json) as unknown;
    if (Array.isArray(terms)) {
      const unique = [...new Set(terms.filter((term): term is string => typeof term === "string").map((term) => term.trim()).filter(Boolean))];
      if (unique.length) return unique.slice(0, 6);
    }
  } catch {
    // A régua continua pesquisável pelo nome se o histórico estiver inválido.
  }
  return [rule.name];
}

export function shouldPauseSource(error: string): boolean {
  return /\b(?:401|403|429)\b/.test(error);
}

function allowedFeedHosts(env: Pick<Env, "AUTHORIZED_FEED_HOSTS">): Set<string> {
  return new Set((env.AUTHORIZED_FEED_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean));
}

export function authorizedFeedUrl(env: Pick<Env, "AUTHORIZED_FEED_HOSTS">, value: string): URL | null {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !allowedFeedHosts(env).has(hostname)) return null;
    if (url.username || url.password || url.port) return null;
    return url;
  } catch {
    return null;
  }
}

function optionalString(value: unknown, max = 2_000): string | undefined {
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : undefined;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function parseAuthorizedFeed(source: SourceConfig, payload: unknown): SourceOffer[] {
  const raw = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { offers?: unknown }).offers)
      ? (payload as { offers: unknown[] }).offers
      : [];
  const offers: SourceOffer[] = [];
  for (const item of raw.slice(0, 500)) {
    if (!item || typeof item !== "object") continue;
    const value = item as Record<string, unknown>;
    const externalId = optionalString(value.externalId, 300);
    const title = optionalString(value.title, 500);
    const url = httpsUrl(value.url);
    const priceCents = Number.isInteger(value.priceCents) && Number(value.priceCents) > 0
      ? Number(value.priceCents)
      : asCents(value.price);
    if (!externalId || !title || !url || !priceCents) continue;
    const condition = ["new", "used", "refurbished", "unknown"].includes(String(value.condition))
      ? value.condition as SourceOffer["condition"]
      : "unknown";
    offers.push({
      sourceId: source.id,
      externalId,
      title,
      description: optionalString(value.description, 20_000),
      url,
      imageUrl: httpsUrl(value.imageUrl),
      imageAuthorized: Boolean(source.image_authorized && value.imageAuthorized),
      sellerName: optionalString(value.sellerName, 300),
      sellerReputation: typeof value.sellerReputation === "number" ? Math.max(0, Math.min(100, value.sellerReputation)) : undefined,
      officialStore: value.officialStore === true,
      condition,
      priceCents,
      pixPriceCents: Number.isInteger(value.pixPriceCents) && Number(value.pixPriceCents) > 0 ? Number(value.pixPriceCents) : undefined,
      installmentText: optionalString(value.installmentText, 300),
      shippingText: optionalString(value.shippingText, 300),
      couponText: optionalString(value.couponText, 300),
      stockStatus: ["in_stock", "out_of_stock", "unknown"].includes(String(value.stockStatus)) ? value.stockStatus as SourceOffer["stockStatus"] : "unknown",
      trailerUrl: httpsUrl(value.trailerUrl),
      warranty: value.warranty === true,
      invoice: value.invoice === true
    });
  }
  return offers;
}

async function authorizedJsonFeed(env: Env, source: SourceConfig, rules: WatchRule[]): Promise<SourceOffer[]> {
  if (!source.search_url_template) throw new Error("feed sem URL configurada");
  const mapped: SourceOffer[] = [];
  for (const rule of rules) {
    for (const query of sourceQueries(rule)) {
      const rawUrl = urlFor(source.search_url_template, query);
      const target = rawUrl ? authorizedFeedUrl(env, rawUrl) : null;
      if (!target) throw new Error("host do feed não autorizado em AUTHORIZED_FEED_HOSTS");
      const response = await fetch(target, { headers: { Accept: "application/json", "User-Agent": "RadarOfertasTelegram/0.1" } });
      if (!response.ok) throw new Error(`feed retornou ${response.status}`);
      const length = Number(response.headers.get("Content-Length") ?? "0");
      if (length > 2_000_000) throw new Error("feed excede 2 MB");
      const text = await response.text();
      if (text.length > 2_000_000) throw new Error("feed excede 2 MB");
      mapped.push(...parseAuthorizedFeed(source, JSON.parse(text)));
    }
  }
  return [...new Map(mapped.map((offer) => [`${offer.sourceId}:${offer.externalId}`, offer])).values()];
}

function asCents(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) : null;
}

async function mercadoLivre(env: Env, source: SourceConfig, rules: WatchRule[]): Promise<SourceOffer[]> {
  const mapped: SourceOffer[] = [];
  const accessToken = await meliAccessToken(env);
  for (const rule of rules) {
    for (const query of sourceQueries(rule)) {
      const response = await fetch(`https://api.mercadolibre.com/sites/MLB/search?q=${encodeURIComponent(query)}&limit=20&sort=price_asc`, {
        headers: { "Accept": "application/json", Authorization: `Bearer ${accessToken}` }
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
      const description = condition === "used" ? await mercadoLivreDescription(externalId, accessToken) : undefined;
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

export async function scanAllowedSources(env: Env, rules: WatchRule[]): Promise<ScanResult[]> {
  const sources = await activeSources(env);
  const results: ScanResult[] = [];
  for (const source of sources) {
    try {
      if (source.id === "mercado-livre") {
        const offers = await mercadoLivre(env, source, rules);
        await sourceOutcome(env, source.id, true);
        results.push({ sourceId: source.id, offers, ok: true });
      } else if (source.kind === "api" && source.search_url_template) {
        const offers = await authorizedJsonFeed(env, source, rules);
        await sourceOutcome(env, source.id, true);
        results.push({ sourceId: source.id, offers, ok: true });
      } else if (source.kind === "browser") {
        results.push({ sourceId: source.id, offers: [], ok: true, error: "delegada ao coletor autorizado" });
      } else {
        results.push({ sourceId: source.id, offers: [], ok: true, error: "sem adaptador aprovado" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      await sourceOutcome(env, source.id, false, message, shouldPauseSource(message));
      results.push({ sourceId: source.id, offers: [], ok: false, error: message });
    }
  }
  return results;
}
