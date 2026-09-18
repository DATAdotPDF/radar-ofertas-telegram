import { formatBRL } from "./scoring";
import type { AlertCandidate, Env } from "./types";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function sourceLabel(sourceId: string): string {
  const names: Record<string, string> = {
    "mercado-livre": "Mercado Livre",
    "amazon-br": "Amazon Brasil",
    "shopee": "Shopee Brasil",
    "eneba": "Eneba",
    "olx": "OLX"
  };
  return names[sourceId] ?? sourceId;
}

function shortDescription(value: string | undefined): string | null {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > 180 ? `${text.slice(0, 177).trimEnd()}...` : text;
}

function sameSecret(actual: string | null, expected: string | undefined): boolean {
  if (!actual || !expected || actual.length !== expected.length) return false;
  let delta = 0;
  for (let index = 0; index < actual.length; index += 1) delta |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  return delta === 0;
}

export function validTelegramWebhook(request: Request, env: Env): boolean {
  return sameSecret(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.TELEGRAM_WEBHOOK_SECRET);
}

async function callTelegram(env: Env, method: string, body: Record<string, unknown>): Promise<{ message_id?: number } | null> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.warn(`Telegram não configurado; mensagem não enviada: ${method}`);
    return null;
  }
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    console.error(`Falha Telegram ${method}: ${response.status}`);
    return null;
  }
  const data = await response.json() as { result?: { message_id?: number } };
  return data.result ?? null;
}

export async function replyTelegram(env: Env, chatId: string, text: string): Promise<void> {
  await callTelegram(env, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

export type TelegramWebhookState = "configured" | "missing_configuration" | "telegram_token_rejected" | "telegram_webhook_rejected" | "network_error";

export async function ensureTelegramWebhook(env: Env): Promise<TelegramWebhookState> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.WORKER_PUBLIC_URL) return "missing_configuration";
  const target = `${env.WORKER_PUBLIC_URL.replace(/\/$/, "")}/telegram/webhook`;
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  try {
    const infoResponse = await fetch(`${base}/getWebhookInfo`);
    const info = await infoResponse.json() as {
      ok?: boolean;
      result?: {
        url?: string;
        pending_update_count?: number;
        last_error_date?: number;
        last_error_message?: string;
      };
    };
    if (!infoResponse.ok) return "telegram_token_rejected";
    if (info.ok && info.result?.url === target) {
      if (info.result.last_error_message || info.result.pending_update_count) {
        console.warn("Diagnóstico de entrega do Telegram", {
          pendingUpdates: info.result.pending_update_count ?? 0,
          lastErrorAt: info.result.last_error_date ?? null,
          lastError: info.result.last_error_message ?? null
        });
      }
      return "configured";
    }
    const response = await fetch(`${base}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: target,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message"],
        drop_pending_updates: false
      })
    });
    const result = await response.json() as { ok?: boolean };
    return result.ok === true ? "configured" : "telegram_webhook_rejected";
  } catch (error) {
    console.error("Não foi possível configurar o webhook do Telegram", error);
    return "network_error";
  }
}

export function offerAlertText(candidate: AlertCandidate): string {
  const { offer } = candidate;
  const summary = shortDescription(offer.description);
  const details = [
    `<b>[${escapeHtml(sourceLabel(offer.sourceId))}] ${escapeHtml(offer.title)}</b>`,
    offer.couponText ? `Cupom: <b>${escapeHtml(offer.couponText)}</b>` : null,
    `Loja/vendedor: ${escapeHtml(offer.sellerName ?? offer.sourceId)}`,
    offer.pixPriceCents ? `PIX: <b>${formatBRL(offer.pixPriceCents)}</b>` : null,
    `À vista: <b>${formatBRL(offer.priceCents)}</b>`,
    offer.installmentText ? `Parcelamento: ${escapeHtml(offer.installmentText)}` : null,
    offer.shippingText ? `Frete: ${escapeHtml(offer.shippingText)}` : null,
    summary ? `Resumo: ${escapeHtml(summary)}` : null,
    `Motivo: ${escapeHtml(candidate.reasons.join("; "))}`,
    offer.condition === "used" || offer.condition === "refurbished" ? `Condição: nota ${candidate.used.score}/100` : null,
    `Verificado: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
  ].filter(Boolean).join("\n");
  return details;
}

export async function sendOfferAlert(env: Env, chatId: string, candidate: AlertCandidate): Promise<string | null> {
  const { offer } = candidate;
  const details = offerAlertText(candidate);
  const markup = { inline_keyboard: [[{ text: "Abrir anúncio", url: offer.url }], ...(offer.trailerUrl ? [[{ text: "Trailer oficial", url: offer.trailerUrl }]] : [])] };
  const body = { chat_id: chatId, caption: details, parse_mode: "HTML", reply_markup: markup };
  const sent = offer.imageUrl && offer.imageAuthorized
    ? await callTelegram(env, "sendPhoto", { ...body, photo: offer.imageUrl })
    : await callTelegram(env, "sendMessage", { ...body, text: details, disable_web_page_preview: true });
  return sent?.message_id ? String(sent.message_id) : null;
}
