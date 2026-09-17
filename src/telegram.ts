import { formatBRL } from "./scoring";
import type { AlertCandidate, Env } from "./types";

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

export type TelegramWebhookState = "configured" | "missing_configuration" | "telegram_rejected" | "network_error";

export async function ensureTelegramWebhook(env: Env): Promise<TelegramWebhookState> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_WEBHOOK_SECRET || !env.WORKER_PUBLIC_URL) return "missing_configuration";
  const target = `${env.WORKER_PUBLIC_URL.replace(/\/$/, "")}/telegram/webhook`;
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  try {
    const infoResponse = await fetch(`${base}/getWebhookInfo`);
    const info = await infoResponse.json() as { ok?: boolean; result?: { url?: string } };
    if (!infoResponse.ok) return "telegram_rejected";
    if (info.ok && info.result?.url === target) return "configured";
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
    return result.ok === true ? "configured" : "telegram_rejected";
  } catch (error) {
    console.error("Não foi possível configurar o webhook do Telegram", error);
    return "network_error";
  }
}

export async function sendOfferAlert(env: Env, chatId: string, candidate: AlertCandidate): Promise<string | null> {
  const { offer } = candidate;
  const details = [
    `<b>${escapeHtml(offer.title)}</b>`,
    `Loja/vendedor: ${escapeHtml(offer.sellerName ?? offer.sourceId)}`,
    offer.pixPriceCents ? `PIX: <b>${formatBRL(offer.pixPriceCents)}</b>` : null,
    `À vista: <b>${formatBRL(offer.priceCents)}</b>`,
    offer.installmentText ? `Parcelamento: ${escapeHtml(offer.installmentText)}` : null,
    offer.shippingText ? `Frete: ${escapeHtml(offer.shippingText)}` : null,
    offer.couponText ? `Cupom/condição: ${escapeHtml(offer.couponText)}` : null,
    `Motivo: ${escapeHtml(candidate.reasons.join("; "))}`,
    offer.condition === "used" || offer.condition === "refurbished" ? `Condição: nota ${candidate.used.score}/100` : null,
    `Verificado: ${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`
  ].filter(Boolean).join("\n");
  const markup = { inline_keyboard: [[{ text: "Abrir anúncio", url: offer.url }], ...(offer.trailerUrl ? [[{ text: "Trailer oficial", url: offer.trailerUrl }]] : [])] };
  const body = { chat_id: chatId, caption: details, parse_mode: "HTML", reply_markup: markup };
  const sent = offer.imageUrl && offer.imageAuthorized
    ? await callTelegram(env, "sendPhoto", { ...body, photo: offer.imageUrl })
    : await callTelegram(env, "sendMessage", { ...body, text: details, disable_web_page_preview: true });
  return sent?.message_id ? String(sent.message_id) : null;
}
