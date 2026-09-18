import type { OfferCondition, PriceContext, SourceOffer, UsedAssessment, WatchRule } from "./types";

const BLOCKED_USED_TERMS = [
  "defeito",
  "defeituoso",
  "pecas",
  "nao liga",
  "banido",
  "replica",
  "sem testar",
  "somente caixa",
  "so a caixa",
  "para conserto",
  "nao funciona",
  "conta digital",
  "conta compartilhada"
];

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function canonicalKey(title: string, category: string): string {
  const normalized = normalizeText(title)
    .replace(/\b(novo|lacrado|usado|seminovo|semi novo|promocao|oferta)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `${normalizeText(category)}:${normalized}`;
}

export function parseTerms(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function matchesRule(offer: SourceOffer, rule: WatchRule): boolean {
  const haystack = normalizeText(`${offer.title} ${offer.description ?? ""}`);
  const include = parseTerms(rule.include_terms_json).map(normalizeText).filter(Boolean);
  const exclude = parseTerms(rule.exclude_terms_json).map(normalizeText).filter(Boolean);
  const hasIncludedTerm = include.length === 0 || include.some((term) => haystack.includes(term));
  const hasExcludedTerm = exclude.some((term) => haystack.includes(term));
  const condition = offer.condition ?? "unknown";
  const scope = rule.condition_scope.split(",").map((item) => item.trim());
  return hasIncludedTerm && !hasExcludedTerm && (scope.includes("all") || scope.includes(condition));
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

export function formatBRL(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "não informado";
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function assessUsedOffer(offer: SourceOffer, referenceMedianCents: number | null): UsedAssessment {
  const condition: OfferCondition = offer.condition ?? "unknown";
  if (condition !== "used" && condition !== "refurbished") {
    return { score: 100, accepted: true, reasons: ["item novo ou condição não usada"] };
  }

  const text = normalizeText(`${offer.title} ${offer.description ?? ""}`);
  const blocked = BLOCKED_USED_TERMS.find((term) => text.includes(term));
  if (blocked) return { score: 0, accepted: false, reasons: [`termo bloqueado: ${blocked}`] };
  if (!offer.imageUrl) return { score: 0, accepted: false, reasons: ["foto obrigatória ausente"] };
  if (normalizeText(offer.description ?? "").length < 80) {
    return { score: 0, accepted: false, reasons: ["descrição com menos de 80 caracteres"] };
  }
  if (referenceMedianCents && offer.priceCents < referenceMedianCents * 0.4) {
    return {
      score: 0,
      accepted: false,
      quarantineReason: "preço abaixo de 40% da mediana de referência",
      reasons: ["preço suspeito, encaminhado à quarentena"]
    };
  }

  let score = 45; // foto e descrição válidas
  const reasons = ["foto e descrição completas"];
  if (offer.officialStore || (offer.sellerReputation ?? 0) >= 80) {
    score += 20;
    reasons.push("vendedor com boa reputação ou loja oficial");
  }
  if (offer.warranty) {
    score += 15;
    reasons.push("garantia informada");
  }
  if (offer.invoice) {
    score += 10;
    reasons.push("nota fiscal informada");
  }
  if (!referenceMedianCents || offer.priceCents >= referenceMedianCents * 0.45) {
    score += 10;
    reasons.push("preço dentro de faixa plausível");
  }
  return { score: Math.min(score, 100), accepted: score >= 70, reasons };
}

export function evaluateTriggers(
  offer: SourceOffer,
  rule: WatchRule,
  context: PriceContext,
  used: UsedAssessment
): { triggers: string[]; reasons: string[] } {
  const triggers: string[] = [];
  const reasons: string[] = [];
  if (rule.max_price_cents !== null && offer.priceCents <= rule.max_price_cents) {
    triggers.push("target_price");
    reasons.push(`abaixo do teto de ${formatBRL(rule.max_price_cents)}`);
  }
  if ((offer.discountPercent ?? 0) >= rule.min_discount_percent) {
    triggers.push("advertised_discount");
    reasons.push(`desconto anunciado de ${offer.discountPercent}%`);
  }
  if (context.previousPriceCents && offer.priceCents <= context.previousPriceCents * 0.95) {
    triggers.push("price_drop");
    reasons.push("queda de pelo menos 5% no mesmo anúncio");
  }
  if (
    context.median30Cents &&
    context.comparableItems >= 5 &&
    context.comparableSources >= 2 &&
    offer.priceCents <= context.median30Cents * 0.9
  ) {
    triggers.push("below_median");
    reasons.push("pelo menos 10% abaixo da mediana de 30 dias");
  }
  if (
    context.historicalMinimumCents &&
    context.historicalSamples >= 3 &&
    offer.priceCents < context.historicalMinimumCents
  ) {
    triggers.push("new_low");
    reasons.push("novo menor preço registrado");
  }
  if ((offer.condition === "used" || offer.condition === "refurbished") && used.accepted && used.score >= rule.min_used_score) {
    triggers.push("quality_used");
    reasons.push(`usado ou seminovo com nota ${used.score}`);
  }
  return { triggers, reasons };
}

export function scoreCandidate(offer: SourceOffer, context: PriceContext, used: UsedAssessment): number {
  const medianDiscount = context.median30Cents
    ? Math.max(0, ((context.median30Cents - offer.priceCents) / context.median30Cents) * 100)
    : 0;
  const drop = context.previousPriceCents
    ? Math.max(0, ((context.previousPriceCents - offer.priceCents) / context.previousPriceCents) * 100)
    : 0;
  return Math.round(medianDiscount * 2 + drop + (offer.officialStore ? 8 : 0) + used.score / 5);
}

export function shouldRepeatAlert(lastPriceCents: number | null, lastSentAt: string | null, currentPriceCents: number, now = Date.now()): boolean {
  if (lastPriceCents === null || lastSentAt === null) return true;
  const elapsed = now - new Date(lastSentAt).getTime();
  if (elapsed >= 24 * 60 * 60 * 1000) return true;
  return currentPriceCents <= lastPriceCents * 0.95;
}
