import {
  activeRules, alertMaySend, allRules, allSources, createRule, getUserSession, pauseRule, priceContext,
  quarantineOffer, quarantinedOffers, recentOffers, recordAlert, removeRule, setUserSession, statusSummary,
  telegramDestinations, updateRule, upsertOffer, upsertTelegramUser
} from "./db";
import { assessUsedOffer, evaluateTriggers, formatBRL, matchesRule, scoreCandidate } from "./scoring";
import { scanAllowedSources } from "./sources";
import { ensureTelegramWebhook, replyTelegram, sendOfferAlert, validTelegramWebhook } from "./telegram";
import type { AlertCandidate, Env, SourceOffer, WatchRule } from "./types";

const MAX_ALERTS_PER_RULE = 3;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });
}

function authorizedInternal(request: Request, env: Env): boolean {
  const provided = request.headers.get("X-Collector-Secret");
  return Boolean(provided && env.COLLECTOR_SHARED_SECRET && provided === env.COLLECTOR_SHARED_SECRET);
}

function owner(env: Env, telegramUserId: string): boolean {
  return Boolean(env.OWNER_TELEGRAM_USER_ID && telegramUserId === env.OWNER_TELEGRAM_USER_ID);
}

function parsePrice(text: string): number | null {
  const clean = text.trim().toLowerCase();
  if (["sem teto", "sem limite", "-"].includes(clean)) return null;
  const numeric = clean.replace(/r\$\s*/g, "").replace(/\./g, "").replace(",", ".").replace(/[^0-9.]/g, "");
  const value = Number(numeric);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}

function draft(value: string | null): Record<string, unknown> {
  try { return value ? JSON.parse(value) as Record<string, unknown> : {}; } catch { return {}; }
}

async function ingestOffers(env: Env, incoming: SourceOffer[]): Promise<{ received: number; candidates: number; sent: number; quarantined: number }> {
  const rules = await activeRules(env);
  const candidates: AlertCandidate[] = [];
  let quarantined = 0;
  for (const sourceOffer of incoming) {
    if (!sourceOffer.sourceId || !sourceOffer.externalId || !sourceOffer.title || !sourceOffer.url || !Number.isInteger(sourceOffer.priceCents)) continue;
    for (const rule of rules) {
      if (!matchesRule(sourceOffer, rule)) continue;
      const stored = await upsertOffer(env, sourceOffer, rule.category);
      const context = await priceContext(env, stored.offer, stored.previousPriceCents);
      const used = assessUsedOffer(stored.offer, context.median30Cents);
      if (used.quarantineReason) {
        await quarantineOffer(env, stored.offer.id, rule.id, used.quarantineReason);
        quarantined += 1;
        continue;
      }
      const evaluated = evaluateTriggers(stored.offer, rule, context, used);
      if (evaluated.triggers.length > 0) {
        candidates.push({ rule, offer: stored.offer, triggers: evaluated.triggers, reasons: evaluated.reasons, used, score: scoreCandidate(stored.offer, context, used) });
      }
    }
  }
  const destinations = await telegramDestinations(env);
  let sent = 0;
  const grouped = new Map<string, AlertCandidate[]>();
  for (const candidate of candidates) grouped.set(candidate.rule.id, [...(grouped.get(candidate.rule.id) ?? []), candidate]);
  for (const items of grouped.values()) {
    const top = items.sort((a, b) => b.score - a.score).slice(0, MAX_ALERTS_PER_RULE);
    for (const candidate of top) {
      if (!await alertMaySend(env, candidate.offer.id, candidate.rule.id, candidate.offer.priceCents)) continue;
      for (const target of destinations) {
        const messageId = await sendOfferAlert(env, target, candidate);
        await recordAlert(env, candidate.offer.id, candidate.rule.id, candidate.triggers[0], candidate.offer.priceCents, target, messageId);
        sent += 1;
      }
    }
  }
  return { received: incoming.length, candidates: candidates.length, sent, quarantined };
}

async function runScan(env: Env): Promise<{ sources: number; offers: number; sent: number }> {
  const rules = await activeRules(env);
  const scan = await scanAllowedSources(env, rules);
  const result = await ingestOffers(env, scan.flatMap((item) => item.offers));
  return { sources: scan.length, offers: result.received, sent: result.sent };
}

async function handleCommand(env: Env, message: { chat: { id: number }; from?: { id: number }; text?: string }): Promise<void> {
  const chatId = String(message.chat.id);
  const userId = message.from ? String(message.from.id) : "";
  const text = (message.text ?? "").trim();
  const isOwner = owner(env, userId);
  await upsertTelegramUser(env, userId, chatId, isOwner);
  if (!isOwner) {
    await replyTelegram(env, chatId, env.OWNER_TELEGRAM_USER_ID ? "Este bot aceita comandos apenas do administrador." : `Seu ID do Telegram é ${userId}. Configure-o como OWNER_TELEGRAM_USER_ID para liberar o bot.`);
    return;
  }
  if (text === "/start") {
    await replyTelegram(env, chatId, "Radar ativo para você. Use /regras, /adicionar ou /status.");
    return;
  }
  if (text === "/adicionar") {
    await setUserSession(env, userId, "rule_name");
    await replyTelegram(env, chatId, "Nome da nova régua?");
    return;
  }
  if (text === "/regras") {
    const rules = await allRules(env);
    const lines = rules.map((rule) => `${rule.id.slice(0, 8)} | ${rule.is_paused ? "pausada" : "ativa"} | ${rule.name} | teto: ${formatBRL(rule.max_price_cents)}`);
    await replyTelegram(env, chatId, lines.length ? lines.join("\n") : "Nenhuma régua cadastrada.");
    return;
  }
  if (text.startsWith("/pausar ")) {
    const id = text.slice(8).trim();
    await replyTelegram(env, chatId, await pauseRule(env, id, true) ? "Régua pausada." : "Régua não encontrada.");
    return;
  }
  if (text.startsWith("/remover ")) {
    const id = text.slice(9).trim();
    await replyTelegram(env, chatId, await removeRule(env, id) ? "Régua removida." : "Régua não encontrada.");
    return;
  }
  if (text.startsWith("/editar ")) {
    const pieces = text.slice(8).split("|").map((item) => item.trim());
    if (pieces.length !== 4) {
      await replyTelegram(env, chatId, "Formato: /editar ID | nome | termo 1, termo 2 | 2500,00 ou sem teto");
      return;
    }
    const ok = await updateRule(env, pieces[0], { name: pieces[1], terms: pieces[2].split(",").map((item) => item.trim()).filter(Boolean), maxPriceCents: parsePrice(pieces[3]) });
    await replyTelegram(env, chatId, ok ? "Régua atualizada." : "Régua não encontrada.");
    return;
  }
  if (text === "/agora") {
    const run = await runScan(env);
    await replyTelegram(env, chatId, `Busca concluída. Fontes ativas: ${run.sources}. Ofertas lidas: ${run.offers}. Alertas enviados: ${run.sent}.`);
    return;
  }
  if (text === "/ofertas") {
    const offers = await recentOffers(env);
    await replyTelegram(env, chatId, offers.length ? offers.map((item) => `${item.source_name}: ${item.title}\n${formatBRL(item.price_cents)}\n${item.url}`).join("\n\n") : "Ainda não há ofertas registradas.");
    return;
  }
  if (text === "/fontes") {
    const sources = await allSources(env);
    await replyTelegram(env, chatId, sources.map((item) => `${item.name}: ${item.status}${item.notes ? ` — ${item.notes}` : ""}`).join("\n"));
    return;
  }
  if (text === "/status") {
    const status = await statusSummary(env);
    await replyTelegram(env, chatId, `Réguas ativas: ${status.activeRules}\nFontes ativas: ${status.activeSources}\nOfertas salvas: ${status.offers}\nQuarentena: ${status.quarantined}\nLuna: ${env.GPT_ANALYSIS_ENABLED === "true" ? "ligado" : "desligado"}`);
    return;
  }
  if (text === "/quarentena") {
    const items = await quarantinedOffers(env);
    await replyTelegram(env, chatId, items.length ? items.map((item) => `${item.title}\n${item.reason}`).join("\n\n") : "Quarentena vazia.");
    return;
  }
  const session = await getUserSession(env, userId);
  const currentDraft = draft(session?.draft_json ?? null);
  if (session?.session_state === "rule_name") {
    await setUserSession(env, userId, "rule_terms", { name: text });
    await replyTelegram(env, chatId, "Termos de busca, separados por vírgula?");
    return;
  }
  if (session?.session_state === "rule_terms") {
    await setUserSession(env, userId, "rule_price", { ...currentDraft, terms: text.split(",").map((item) => item.trim()).filter(Boolean) });
    await replyTelegram(env, chatId, "Teto em reais ou escreva sem teto?");
    return;
  }
  if (session?.session_state === "rule_price") {
    await createRule(env, { name: String(currentDraft.name ?? "Nova régua"), terms: Array.isArray(currentDraft.terms) ? currentDraft.terms.filter((item): item is string => typeof item === "string") : [], maxPriceCents: parsePrice(text) });
    await setUserSession(env, userId, null);
    await replyTelegram(env, chatId, "Régua criada e ativa.");
    return;
  }
  await replyTelegram(env, chatId, "Comando não reconhecido. Use /start para ver o início.");
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      const telegramWebhook = await ensureTelegramWebhook(env);
      return json({ ok: true, aiEnabled: env.GPT_ANALYSIS_ENABLED === "true", telegramWebhook });
    }
    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      if (!validTelegramWebhook(request, env)) return new Response("forbidden", { status: 403 });
      const update = await request.json() as { message?: { chat: { id: number }; from?: { id: number }; text?: string } };
      if (update.message?.text) await handleCommand(env, update.message);
      return new Response("ok");
    }
    if (url.pathname.startsWith("/internal/")) {
      if (!authorizedInternal(request, env)) return new Response("forbidden", { status: 403 });
      if (request.method === "GET" && url.pathname === "/internal/rules") return json({ rules: await activeRules(env), sources: await allSources(env) });
      if (request.method === "POST" && url.pathname === "/internal/ingest") {
        const data = await request.json() as { offers?: SourceOffer[] };
        return json(await ingestOffers(env, Array.isArray(data.offers) ? data.offers.slice(0, 500) : []));
      }
    }
    return new Response("not found", { status: 404 });
  },
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(Promise.all([runScan(env), ensureTelegramWebhook(env)]));
  }
} satisfies ExportedHandler<Env>;
