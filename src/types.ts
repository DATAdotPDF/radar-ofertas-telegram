export type OfferCondition = "new" | "used" | "refurbished" | "unknown";
export type SourceKind = "api" | "html" | "browser" | "manual";
export type SourceStatus = "pending" | "allowed" | "active" | "paused" | "blocked";

export interface Env {
  DB: D1Database;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  OWNER_TELEGRAM_USER_ID?: string;
  COLLECTOR_SHARED_SECRET?: string;
  WORKER_PUBLIC_URL?: string;
  GPT_ANALYSIS_ENABLED?: string;
  OPENAI_API_KEY?: string;
  AI_MONTHLY_BUDGET_USD?: string;
  MELI_CLIENT_ID?: string;
  MELI_CLIENT_SECRET?: string;
  MELI_TOKEN_ENCRYPTION_KEY?: string;
  AUTHORIZED_FEED_HOSTS?: string;
}

export interface WatchRule {
  id: string;
  tenant_id: string;
  name: string;
  include_terms_json: string;
  exclude_terms_json: string;
  category: string;
  condition_scope: string;
  max_price_cents: number | null;
  min_used_score: number;
  alert_limit: number;
  is_paused: number;
  deleted_at: string | null;
}

export interface SourceConfig {
  id: string;
  tenant_id: string;
  name: string;
  kind: SourceKind;
  status: SourceStatus;
  policy_url: string | null;
  search_url_template: string | null;
  image_authorized: number;
  notes: string | null;
}

export interface SourceOffer {
  sourceId: string;
  externalId: string;
  title: string;
  description?: string;
  url: string;
  imageUrl?: string;
  imageAuthorized?: boolean;
  sellerName?: string;
  sellerReputation?: number;
  officialStore?: boolean;
  condition?: OfferCondition;
  priceCents: number;
  pixPriceCents?: number;
  installmentText?: string;
  shippingText?: string;
  couponText?: string;
  stockStatus?: "in_stock" | "out_of_stock" | "unknown";
  trailerUrl?: string;
  warranty?: boolean;
  invoice?: boolean;
}

export interface OfferRecord extends SourceOffer {
  id: string;
  canonicalKey: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface PriceContext {
  previousPriceCents: number | null;
  median30Cents: number | null;
  comparableItems: number;
  comparableSources: number;
  historicalMinimumCents: number | null;
  historicalSamples: number;
}

export interface UsedAssessment {
  score: number;
  accepted: boolean;
  quarantineReason?: string;
  reasons: string[];
}

export interface AlertCandidate {
  rule: WatchRule;
  offer: OfferRecord;
  triggers: string[];
  reasons: string[];
  score: number;
  used: UsedAssessment;
}

export interface AiAnalysis {
  summary: string;
  edition: string | null;
  condition: string | null;
  accessories: string[];
  riskSignals: Array<{ signal: string; evidence: string }>;
  ambiguousTitle: boolean;
}
