import type { Env } from "./types";

type MeliToken = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};

function base64Url(bytes: Uint8Array): string {
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function exactBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function randomUrlSafe(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return base64Url(value);
}

function redirectUri(env: Env): string {
  if (!env.WORKER_PUBLIC_URL) throw new Error("URL pública do Worker não configurada");
  return `${env.WORKER_PUBLIC_URL.replace(/\/$/, "")}/oauth/mercadolivre/callback`;
}

async function encryptionKey(env: Env): Promise<CryptoKey> {
  if (!env.MELI_TOKEN_ENCRYPTION_KEY) throw new Error("Chave de criptografia do Mercado Livre não configurada");
  const raw = fromBase64Url(env.MELI_TOKEN_ENCRYPTION_KEY);
  if (raw.byteLength !== 32) throw new Error("Chave de criptografia do Mercado Livre inválida");
  return crypto.subtle.importKey("raw", exactBuffer(raw), "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(env: Env, value: string): Promise<{ ciphertext: string; iv: string }> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv: exactBuffer(iv) }, await encryptionKey(env), exactBuffer(new TextEncoder().encode(value)));
  return { ciphertext: base64Url(new Uint8Array(encrypted)), iv: base64Url(iv) };
}

async function unseal(env: Env, ciphertext: string, iv: string): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: exactBuffer(fromBase64Url(iv)) },
    await encryptionKey(env),
    exactBuffer(fromBase64Url(ciphertext))
  );
  return new TextDecoder().decode(decrypted);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", exactBuffer(new TextEncoder().encode(verifier)));
  return base64Url(new Uint8Array(digest));
}

export async function createMeliAuthorizationUrl(env: Env): Promise<string> {
  if (!env.MELI_CLIENT_ID || !env.MELI_CLIENT_SECRET || !env.MELI_TOKEN_ENCRYPTION_KEY) {
    throw new Error("Credenciais do aplicativo Mercado Livre ainda não foram configuradas");
  }
  const state = randomUrlSafe();
  const verifier = randomUrlSafe(48);
  const sealed = await seal(env, verifier);
  await env.DB.prepare("DELETE FROM oauth_sessions WHERE provider = 'mercado_livre' AND expires_at < datetime('now')").run();
  await env.DB.prepare(`
    INSERT INTO oauth_sessions (provider, state, verifier_ciphertext, verifier_iv, expires_at, created_at)
    VALUES ('mercado_livre', ?, ?, ?, datetime('now', '+10 minutes'), datetime('now'))
  `).bind(state, sealed.ciphertext, sealed.iv).run();
  const url = new URL("https://auth.mercadolivre.com.br/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", env.MELI_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri(env));
  url.searchParams.set("code_challenge", await pkceChallenge(verifier));
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

async function storeToken(env: Env, token: MeliToken): Promise<void> {
  const sealed = await seal(env, JSON.stringify(token));
  await env.DB.prepare(`
    INSERT INTO provider_oauth_tokens (provider, ciphertext, iv, expires_at, updated_at)
    VALUES ('mercado_livre', ?, ?, datetime(?, 'unixepoch'), datetime('now'))
    ON CONFLICT(provider) DO UPDATE SET ciphertext=excluded.ciphertext, iv=excluded.iv, expires_at=excluded.expires_at, updated_at=excluded.updated_at
  `).bind(sealed.ciphertext, sealed.iv, Math.floor(token.expires_at / 1000)).run();
}

async function tokenResponse(response: Response): Promise<MeliToken> {
  if (!response.ok) throw new Error(`OAuth Mercado Livre retornou ${response.status}`);
  const data = await response.json() as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown };
  if (typeof data.access_token !== "string" || typeof data.refresh_token !== "string" || typeof data.expires_in !== "number") {
    throw new Error("OAuth Mercado Livre retornou uma resposta inválida");
  }
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000 };
}

async function refreshToken(env: Env, refreshToken: string): Promise<MeliToken> {
  if (!env.MELI_CLIENT_ID || !env.MELI_CLIENT_SECRET) throw new Error("Credenciais do aplicativo Mercado Livre não configuradas");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: env.MELI_CLIENT_ID,
    client_secret: env.MELI_CLIENT_SECRET,
    refresh_token: refreshToken
  });
  return tokenResponse(await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body
  }));
}

export async function completeMeliAuthorization(env: Env, code: string | null, state: string | null): Promise<void> {
  if (!code || !state || !env.MELI_CLIENT_ID || !env.MELI_CLIENT_SECRET) throw new Error("Retorno OAuth inválido");
  const session = await env.DB.prepare(`
    SELECT verifier_ciphertext, verifier_iv FROM oauth_sessions
    WHERE provider='mercado_livre' AND state=? AND expires_at >= datetime('now')
  `).bind(state).first<{ verifier_ciphertext: string; verifier_iv: string }>();
  if (!session) throw new Error("Autorização expirada ou inválida");
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: env.MELI_CLIENT_ID,
    client_secret: env.MELI_CLIENT_SECRET,
    code,
    redirect_uri: redirectUri(env),
    code_verifier: await unseal(env, session.verifier_ciphertext, session.verifier_iv)
  });
  const token = await tokenResponse(await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body
  }));
  await storeToken(env, token);
  await env.DB.prepare("UPDATE source_configs SET status='active', last_error=NULL, failure_count=0, updated_at=datetime('now') WHERE id='mercado-livre' AND tenant_id='default'").run();
  await env.DB.prepare("DELETE FROM oauth_sessions WHERE provider='mercado_livre' AND state=?").bind(state).run();
}

export async function meliAccessToken(env: Env): Promise<string> {
  const row = await env.DB.prepare("SELECT ciphertext, iv FROM provider_oauth_tokens WHERE provider='mercado_livre'")
    .first<{ ciphertext: string; iv: string }>();
  if (!row) throw new Error("Mercado Livre aguarda autorização OAuth");
  const token = JSON.parse(await unseal(env, row.ciphertext, row.iv)) as MeliToken;
  if (token.expires_at > Date.now() + 120_000) return token.access_token;
  const refreshed = await refreshToken(env, token.refresh_token);
  await storeToken(env, refreshed);
  return refreshed.access_token;
}

export async function meliOAuthState(env: Env): Promise<"not_configured" | "awaiting_authorization" | "authorized"> {
  if (!env.MELI_CLIENT_ID || !env.MELI_CLIENT_SECRET || !env.MELI_TOKEN_ENCRYPTION_KEY) return "not_configured";
  const token = await env.DB.prepare("SELECT provider FROM provider_oauth_tokens WHERE provider='mercado_livre'").first();
  return token ? "authorized" : "awaiting_authorization";
}
