import type { Env, SourceConfig, SourceOffer } from "./types";

type CachedToken = { value: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

function credentials(env: Env): { id: string; secret: string; version: string; tag: string } {
  const id = env.AMAZON_CREATORS_CREDENTIAL_ID;
  const secret = env.AMAZON_CREATORS_CREDENTIAL_SECRET;
  const tag = env.AMAZON_ASSOCIATE_TAG;
  const version = env.AMAZON_CREATORS_CREDENTIAL_VERSION ?? "3.1";
  if (!id || !secret || !tag) throw new Error("Amazon Creators API aguarda credenciais");
  return { id, secret, version, tag };
}

function tokenEndpoint(version: string): string {
  const endpoints: Record<string, string> = {
    "3.1": "https://api.amazon.com/auth/o2/token",
    "3.2": "https://api.amazon.co.uk/auth/o2/token",
    "3.3": "https://api.amazon.co.jp/auth/o2/token"
  };
  const endpoint = endpoints[version];
  if (!endpoint) throw new Error("Versão da credencial Amazon inválida");
  return endpoint;
}

async function accessToken(env: Env): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 120_000) return cachedToken.value;
  const value = credentials(env);
  const response = await fetch(tokenEndpoint(value.version), {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: value.id,
      client_secret: value.secret,
      scope: "creatorsapi::default"
    })
  });
  if (!response.ok) throw new Error(`OAuth Amazon retornou ${response.status}`);
  const data = await response.json() as { access_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string" || typeof data.expires_in !== "number") {
    throw new Error("OAuth Amazon retornou resposta inválida");
  }
  cachedToken = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.value;
}

function cents(value: unknown): number | null {
  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

function offerCondition(value: unknown): SourceOffer["condition"] {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "used") return "used";
  if (normalized === "refurbished") return "refurbished";
  if (normalized === "new") return "new";
  return "unknown";
}

export function parseAmazonItems(source: SourceConfig, payload: unknown): SourceOffer[] {
  if (!payload || typeof payload !== "object") return [];
  const items = (payload as { searchResult?: { items?: unknown[] } }).searchResult?.items;
  if (!Array.isArray(items)) return [];
  const offers: SourceOffer[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, any>;
    const listings = Array.isArray(item.offersV2?.listings) ? item.offersV2.listings : [];
    const listing = listings.find((value: any) => value?.isBuyBoxWinner && value?.price?.money?.amount)
      ?? listings.find((value: any) => value?.price?.money?.amount);
    const priceCents = cents(listing?.price?.money?.amount);
    const asin = typeof item.asin === "string" ? item.asin : null;
    const title = item.itemInfo?.title?.displayValue;
    const url = item.detailPageURL;
    if (!asin || typeof title !== "string" || typeof url !== "string" || !priceCents) continue;
    const features = Array.isArray(item.itemInfo?.features?.displayValues)
      ? item.itemInfo.features.displayValues.filter((value: unknown) => typeof value === "string")
      : [];
    const availability = String(listing?.availability?.type ?? "UNKNOWN").toUpperCase();
    const imageUrl = item.images?.primary?.large?.url ?? item.images?.primary?.medium?.url ?? item.images?.primary?.small?.url;
    const discountPercent = Number(listing?.price?.savings?.percentage);
    offers.push({
      sourceId: source.id,
      externalId: asin,
      title,
      description: features.slice(0, 5).join(" "),
      url,
      imageUrl: typeof imageUrl === "string" ? imageUrl : undefined,
      imageAuthorized: true,
      sellerName: typeof listing?.merchantInfo?.name === "string" ? listing.merchantInfo.name : "Amazon Brasil",
      officialStore: /amazon/i.test(String(listing?.merchantInfo?.name ?? "")),
      condition: offerCondition(listing?.condition?.value),
      priceCents,
      originalPriceCents: cents(listing?.price?.savingBasis?.money?.amount) ?? undefined,
      discountPercent: Number.isFinite(discountPercent) && discountPercent > 0 ? Math.round(discountPercent) : undefined,
      stockStatus: ["IN_STOCK", "INSTOCKSCARCE", "PREORDER"].includes(availability)
        ? "in_stock"
        : availability === "OUTOFSTOCK" ? "out_of_stock" : "unknown"
    });
  }
  return offers;
}

export async function amazonSearch(env: Env, source: SourceConfig, queries: string[]): Promise<SourceOffer[]> {
  const token = await accessToken(env);
  const { tag } = credentials(env);
  const mapped: SourceOffer[] = [];
  for (const query of queries) {
    const response = await fetch("https://creatorsapi.amazon/catalog/v1/searchItems", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-marketplace": "www.amazon.com.br"
      },
      body: JSON.stringify({
        partnerTag: tag,
        marketplace: "www.amazon.com.br",
        languagesOfPreference: ["pt_BR"],
        currencyOfPreference: "BRL",
        searchIndex: "All",
        keywords: query,
        itemCount: 10,
        itemPage: 1,
        resources: [
          "images.primary.large",
          "itemInfo.title",
          "itemInfo.features",
          "offersV2.listings.availability",
          "offersV2.listings.condition",
          "offersV2.listings.dealDetails",
          "offersV2.listings.isBuyBoxWinner",
          "offersV2.listings.merchantInfo",
          "offersV2.listings.price",
          "offersV2.listings.type"
        ]
      })
    });
    if (!response.ok) throw new Error(`Amazon Creators API retornou ${response.status}`);
    mapped.push(...parseAmazonItems(source, await response.json()));
  }
  return [...new Map(mapped.map((offer) => [offer.externalId, offer])).values()];
}

export function amazonConfigurationState(env: Env): "configured" | "awaiting_credentials" {
  return env.AMAZON_CREATORS_CREDENTIAL_ID && env.AMAZON_CREATORS_CREDENTIAL_SECRET && env.AMAZON_ASSOCIATE_TAG
    ? "configured"
    : "awaiting_credentials";
}
