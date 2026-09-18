import { chromium } from "playwright";

const baseUrl = process.env.COLLECTOR_BASE_URL;
const secret = process.env.COLLECTOR_SHARED_SECRET;

if (!baseUrl || !secret) throw new Error("COLLECTOR_BASE_URL e COLLECTOR_SHARED_SECRET são obrigatórios.");

const headers = { "X-Collector-Secret": secret, "Content-Type": "application/json" };
const api = (path, options = {}) => fetch(`${baseUrl.replace(/\/$/, "")}${path}`, { headers, ...options });
const response = await fetch(`${baseUrl.replace(/\/$/, "")}/internal/rules`, { headers });
if (!response.ok) throw new Error(`Não foi possível obter as fontes: ${response.status}`);
const { rules, sources } = await response.json();
const browserSources = sources.filter((source) => source.status === "active" && source.kind === "browser" && source.search_url_template);

if (browserSources.length === 0) {
  console.log("Nenhuma fonte de navegador ativa.");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const offers = [];
const report = async (sourceId, ok, error = null, pause = false) => {
  const result = await api("/internal/source-outcome", {
    method: "POST",
    body: JSON.stringify({ sourceId, ok, error, pause })
  });
  if (!result.ok) throw new Error(`Falha ao registrar estado de ${sourceId}: ${result.status}`);
};
try {
  for (const source of browserSources) {
    try {
      for (const rule of rules) {
        const terms = JSON.parse(rule.include_terms_json);
        const query = terms[0] ?? rule.name;
        const target = source.search_url_template.replace("{query}", encodeURIComponent(query));
        const page = await browser.newPage();
        try {
          const navigation = await page.goto(target, { waitUntil: "domcontentloaded", timeout: 30_000 });
          const code = navigation?.status() ?? 0;
          if ([401, 403, 429].includes(code)) throw new Error(`HTTP ${code}; fonte pausada para revisão`);
          const pageTitle = await page.title();
          const pageText = (await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")).slice(0, 5_000);
          if (/captcha|just a moment|verifique que você é humano|verify you are human/i.test(`${pageTitle}\n${pageText}`)) {
            throw new Error("desafio anti-bot detectado; fonte pausada para revisão");
          }
          const products = await page.evaluate(() => {
            const scripts = [...document.querySelectorAll('script[type="application/ld+json"]')];
            const flatten = (value) => Array.isArray(value) ? value.flatMap(flatten) : value?.["@graph"] ? flatten(value["@graph"]) : [value];
            return scripts.flatMap((script) => {
              try { return flatten(JSON.parse(script.textContent ?? "")); } catch { return []; }
            }).filter((item) => item && (item["@type"] === "Product" || (Array.isArray(item["@type"]) && item["@type"].includes("Product"))));
          });
          for (const product of products) {
            const listing = Array.isArray(product.offers) ? product.offers[0] : product.offers;
            const price = Number(listing?.price);
            const url = listing?.url || product.url;
            if (!product.name || !url || !Number.isFinite(price) || price <= 0) continue;
            offers.push({
              sourceId: source.id,
              externalId: String(product.sku || url),
              title: String(product.name),
              description: typeof product.description === "string" ? product.description : "",
              url: String(url),
              imageUrl: typeof product.image === "string" ? product.image : Array.isArray(product.image) ? product.image[0] : undefined,
              imageAuthorized: Boolean(source.image_authorized),
              sellerName: typeof listing?.seller?.name === "string" ? listing.seller.name : source.name,
              officialStore: true,
              condition: "new",
              priceCents: Math.round(price * 100),
              stockStatus: listing?.availability?.includes("InStock") ? "in_stock" : "unknown"
            });
          }
        } finally {
          await page.close();
        }
      }
      await report(source.id, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "erro desconhecido";
      const pause = /401|403|429|captcha|anti-bot/i.test(message);
      await report(source.id, false, message, pause);
      console.error(`${source.name}: ${message}`);
    }
  }
} finally {
  await browser.close();
}

const ingest = await api("/internal/ingest", { method: "POST", body: JSON.stringify({ offers }) });
if (!ingest.ok) throw new Error(`Falha ao registrar ofertas: ${ingest.status}`);
console.log(await ingest.text());
