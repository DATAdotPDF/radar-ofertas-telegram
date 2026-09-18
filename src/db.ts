import { canonicalKey } from "./scoring";
import type { Env, OfferRecord, SourceConfig, SourceOffer, WatchRule } from "./types";

const DEFAULT_TENANT = "default";

function id(): string {
  return crypto.randomUUID();
}

async function rows<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function activeRules(env: Env): Promise<WatchRule[]> {
  return rows<WatchRule>(env.DB.prepare(
    "SELECT * FROM watch_rules WHERE tenant_id = ? AND is_paused = 0 AND deleted_at IS NULL ORDER BY created_at"
  ).bind(DEFAULT_TENANT));
}

export async function allRules(env: Env): Promise<WatchRule[]> {
  return rows<WatchRule>(env.DB.prepare(
    "SELECT * FROM watch_rules WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY created_at"
  ).bind(DEFAULT_TENANT));
}

export async function activeSources(env: Env): Promise<SourceConfig[]> {
  return rows<SourceConfig>(env.DB.prepare(
    "SELECT * FROM source_configs WHERE tenant_id = ? AND status = 'active' ORDER BY name"
  ).bind(DEFAULT_TENANT));
}

export async function allSources(env: Env): Promise<SourceConfig[]> {
  return rows<SourceConfig>(env.DB.prepare(
    "SELECT * FROM source_configs WHERE tenant_id = ? ORDER BY name"
  ).bind(DEFAULT_TENANT));
}

export async function upsertTelegramUser(env: Env, telegramId: string, chatId: string, isOwner: boolean): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO telegram_users (id, tenant_id, telegram_user_id, chat_id, role, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(telegram_user_id) DO UPDATE SET
      chat_id = excluded.chat_id,
      role = CASE WHEN excluded.role = 'owner' THEN 'owner' ELSE telegram_users.role END,
      updated_at = datetime('now')
  `).bind(id(), DEFAULT_TENANT, telegramId, chatId, isOwner ? "owner" : "subscriber").run();
  if (isOwner) {
    await env.DB.prepare(`
      INSERT INTO destinations (id, tenant_id, chat_id, kind, active, created_at)
      VALUES (?, ?, ?, 'private', 1, datetime('now'))
      ON CONFLICT(tenant_id, chat_id) DO UPDATE SET active = 1
    `).bind(id(), DEFAULT_TENANT, chatId).run();
  }
}

export async function setUserSession(env: Env, telegramId: string, state: string | null, draft: unknown = null): Promise<void> {
  await env.DB.prepare("UPDATE telegram_users SET session_state = ?, draft_json = ?, updated_at = datetime('now') WHERE tenant_id = ? AND telegram_user_id = ?")
    .bind(state, draft === null ? null : JSON.stringify(draft), DEFAULT_TENANT, telegramId).run();
}

export async function getUserSession(env: Env, telegramId: string): Promise<{ session_state: string | null; draft_json: string | null } | null> {
  return env.DB.prepare("SELECT session_state, draft_json FROM telegram_users WHERE tenant_id = ? AND telegram_user_id = ?")
    .bind(DEFAULT_TENANT, telegramId).first<{ session_state: string | null; draft_json: string | null }>();
}

export async function createRule(env: Env, rule: { name: string; terms: string[]; maxPriceCents: number | null }): Promise<void> {
  await env.DB.prepare(`
    INSERT INTO watch_rules (id, tenant_id, name, include_terms_json, exclude_terms_json, category, condition_scope, max_price_cents, min_used_score, alert_limit, is_paused, created_at, updated_at)
    VALUES (?, ?, ?, ?, '[]', 'custom', 'new,used,refurbished,unknown', ?, 70, 3, 0, datetime('now'), datetime('now'))
  `).bind(id(), DEFAULT_TENANT, rule.name, JSON.stringify(rule.terms), rule.maxPriceCents).run();
}

async function resolvedRuleId(env: Env, suppliedId: string): Promise<string | null> {
  if (!/^[a-f0-9-]{8,36}$/i.test(suppliedId)) return null;
  const row = await env.DB.prepare("SELECT id FROM watch_rules WHERE tenant_id = ? AND deleted_at IS NULL AND id LIKE ? LIMIT 2")
    .bind(DEFAULT_TENANT, `${suppliedId}%`).all<{ id: string }>();
  return row.results?.length === 1 ? row.results[0].id : null;
}

export async function updateRule(env: Env, ruleId: string, values: { name: string; terms: string[]; maxPriceCents: number | null }): Promise<boolean> {
  const id = await resolvedRuleId(env, ruleId);
  if (!id) return false;
  const result = await env.DB.prepare(`
    UPDATE watch_rules SET name = ?, include_terms_json = ?, max_price_cents = ?, updated_at = datetime('now')
    WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL
  `).bind(values.name, JSON.stringify(values.terms), values.maxPriceCents, id, DEFAULT_TENANT).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function pauseRule(env: Env, ruleId: string, paused: boolean): Promise<boolean> {
  const id = await resolvedRuleId(env, ruleId);
  if (!id) return false;
  const result = await env.DB.prepare("UPDATE watch_rules SET is_paused = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .bind(paused ? 1 : 0, id, DEFAULT_TENANT).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function removeRule(env: Env, ruleId: string): Promise<boolean> {
  const id = await resolvedRuleId(env, ruleId);
  if (!id) return false;
  const result = await env.DB.prepare("UPDATE watch_rules SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND tenant_id = ? AND deleted_at IS NULL")
    .bind(id, DEFAULT_TENANT).run();
  return (result.meta.changes ?? 0) > 0;
}

export async function upsertOffer(env: Env, incoming: SourceOffer, category: string): Promise<{ offer: OfferRecord; previousPriceCents: number | null }> {
  const existing = await env.DB.prepare("SELECT * FROM offers WHERE tenant_id = ? AND source_id = ? AND external_id = ?")
    .bind(DEFAULT_TENANT, incoming.sourceId, incoming.externalId).first<Record<string, unknown>>();
  const now = new Date().toISOString();
  const offerId = typeof existing?.id === "string" ? existing.id : id();
  const previous = await env.DB.prepare("SELECT price_cents FROM offer_observations WHERE offer_id = ? ORDER BY observed_at DESC LIMIT 1")
    .bind(offerId).first<{ price_cents: number }>();
  const key = canonicalKey(incoming.title, category);
  const data = {
    title: incoming.title,
    description: incoming.description ?? "",
    url: incoming.url,
    image_url: incoming.imageUrl ?? null,
    image_authorized: incoming.imageAuthorized ? 1 : 0,
    seller_name: incoming.sellerName ?? null,
    seller_reputation: incoming.sellerReputation ?? null,
    official_store: incoming.officialStore ? 1 : 0,
    condition: incoming.condition ?? "unknown",
    canonical_key: key,
    trailer_url: incoming.trailerUrl ?? null,
    warranty: incoming.warranty ? 1 : 0,
    invoice: incoming.invoice ? 1 : 0
  };
  if (existing) {
    await env.DB.prepare(`UPDATE offers SET title=?, description=?, url=?, image_url=?, image_authorized=?, seller_name=?, seller_reputation=?, official_store=?, condition=?, canonical_key=?, trailer_url=?, warranty=?, invoice=?, last_seen_at=? WHERE id=?`)
      .bind(data.title, data.description, data.url, data.image_url, data.image_authorized, data.seller_name, data.seller_reputation, data.official_store, data.condition, data.canonical_key, data.trailer_url, data.warranty, data.invoice, now, offerId).run();
  } else {
    await env.DB.prepare(`INSERT INTO offers (id, tenant_id, source_id, external_id, title, description, url, image_url, image_authorized, seller_name, seller_reputation, official_store, condition, canonical_key, trailer_url, warranty, invoice, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(offerId, DEFAULT_TENANT, incoming.sourceId, incoming.externalId, data.title, data.description, data.url, data.image_url, data.image_authorized, data.seller_name, data.seller_reputation, data.official_store, data.condition, data.canonical_key, data.trailer_url, data.warranty, data.invoice, now, now).run();
  }
  await env.DB.prepare(`INSERT INTO offer_observations (id, offer_id, price_cents, pix_price_cents, installment_text, shipping_text, coupon_text, stock_status, observed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id(), offerId, incoming.priceCents, incoming.pixPriceCents ?? null, incoming.installmentText ?? null, incoming.shippingText ?? null, incoming.couponText ?? null, incoming.stockStatus ?? "unknown", now).run();
  return {
    previousPriceCents: previous?.price_cents ?? null,
    offer: { ...incoming, id: offerId, canonicalKey: key, firstSeenAt: typeof existing?.first_seen_at === "string" ? existing.first_seen_at : now, lastSeenAt: now }
  };
}

export async function priceContext(env: Env, offer: OfferRecord, previousPriceCents: number | null): Promise<import("./types").PriceContext> {
  const comparable = await rows<{ price_cents: number; offer_id: string; source_id: string }>(env.DB.prepare(`
    SELECT ob.price_cents, o.id AS offer_id, o.source_id
    FROM offer_observations ob JOIN offers o ON o.id = ob.offer_id
    WHERE o.tenant_id = ? AND o.canonical_key = ? AND o.condition = ? AND ob.observed_at >= datetime('now', '-30 days')
  `).bind(DEFAULT_TENANT, offer.canonicalKey, offer.condition ?? "unknown"));
  const prices = comparable.map((item) => item.price_cents).sort((a, b) => a - b);
  const uniqueOffers = new Set(comparable.map((item) => item.offer_id));
  const sources = new Set(comparable.map((item) => item.source_id));
  const older = prices.filter((price) => price !== offer.priceCents || comparable.length > 1);
  const medianValue = prices.length ? prices[Math.floor(prices.length / 2)] : null;
  return {
    previousPriceCents,
    median30Cents: medianValue,
    comparableItems: uniqueOffers.size,
    comparableSources: sources.size,
    historicalMinimumCents: older.length ? Math.min(...older) : null,
    historicalSamples: older.length
  };
}

export async function quarantineOffer(env: Env, offerId: string, ruleId: string, reason: string): Promise<void> {
  await env.DB.prepare(`INSERT INTO quarantined_offers (id, tenant_id, offer_id, rule_id, reason, status, created_at) VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'))`)
    .bind(id(), DEFAULT_TENANT, offerId, ruleId, reason).run();
}

export async function alertMaySend(env: Env, offerId: string, ruleId: string, priceCents: number): Promise<boolean> {
  const latest = await env.DB.prepare("SELECT price_cents, sent_at FROM alert_events WHERE offer_id = ? AND rule_id = ? ORDER BY sent_at DESC LIMIT 1")
    .bind(offerId, ruleId).first<{ price_cents: number; sent_at: string }>();
  if (!latest) return true;
  const elapsed = Date.now() - new Date(latest.sent_at).getTime();
  return elapsed >= 24 * 60 * 60 * 1000 || priceCents <= latest.price_cents * 0.95;
}

export async function recordAlert(env: Env, offerId: string, ruleId: string, trigger: string, priceCents: number, destination: string, telegramMessageId: string | null): Promise<void> {
  await env.DB.prepare(`INSERT OR IGNORE INTO alert_events (id, tenant_id, offer_id, rule_id, trigger_type, price_cents, destination, telegram_message_id, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`)
    .bind(id(), DEFAULT_TENANT, offerId, ruleId, trigger, priceCents, destination, telegramMessageId).run();
}

export async function telegramDestinations(env: Env): Promise<string[]> {
  const result = await rows<{ chat_id: string }>(env.DB.prepare("SELECT chat_id FROM destinations WHERE tenant_id = ? AND active = 1")
    .bind(DEFAULT_TENANT));
  return result.map((item) => item.chat_id);
}

export async function recentOffers(env: Env, limit = 10): Promise<Array<{ title: string; url: string; price_cents: number; source_name: string; observed_at: string }>> {
  return rows(env.DB.prepare(`
    SELECT o.title, o.url, ob.price_cents, s.name AS source_name, ob.observed_at
    FROM offer_observations ob JOIN offers o ON o.id = ob.offer_id JOIN source_configs s ON s.id = o.source_id
    WHERE o.tenant_id = ? ORDER BY ob.observed_at DESC LIMIT ?
  `).bind(DEFAULT_TENANT, limit));
}

export async function quarantinedOffers(env: Env, limit = 10): Promise<Array<{ title: string; reason: string; created_at: string }>> {
  return rows(env.DB.prepare(`
    SELECT o.title, q.reason, q.created_at FROM quarantined_offers q JOIN offers o ON o.id = q.offer_id
    WHERE q.tenant_id = ? AND q.status = 'pending' ORDER BY q.created_at DESC LIMIT ?
  `).bind(DEFAULT_TENANT, limit));
}

export async function statusSummary(env: Env): Promise<{ activeRules: number; activeSources: number; offers: number; quarantined: number }> {
  const result = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM watch_rules WHERE tenant_id=? AND is_paused=0 AND deleted_at IS NULL) AS activeRules,
      (SELECT COUNT(*) FROM source_configs WHERE tenant_id=? AND status='active') AS activeSources,
      (SELECT COUNT(*) FROM offers WHERE tenant_id=?) AS offers,
      (SELECT COUNT(*) FROM quarantined_offers WHERE tenant_id=? AND status='pending') AS quarantined
  `).bind(DEFAULT_TENANT, DEFAULT_TENANT, DEFAULT_TENANT, DEFAULT_TENANT).first<{ activeRules: number; activeSources: number; offers: number; quarantined: number }>();
  return result ?? { activeRules: 0, activeSources: 0, offers: 0, quarantined: 0 };
}

export async function sourceOutcome(env: Env, sourceId: string, ok: boolean, error: string | null = null, pause = false): Promise<void> {
  await env.DB.prepare(`
    UPDATE source_configs
    SET last_success_at = CASE WHEN ? THEN datetime('now') ELSE last_success_at END,
        last_error = ?,
        failure_count = CASE WHEN ? THEN 0 ELSE failure_count + 1 END,
        status = CASE WHEN ? THEN 'paused' ELSE status END
    WHERE id = ? AND tenant_id = ?
  `).bind(ok ? 1 : 0, error, ok ? 1 : 0, pause ? 1 : 0, sourceId, DEFAULT_TENANT).run();
}
