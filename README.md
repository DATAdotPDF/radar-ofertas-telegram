# Radar configurável de ofertas pelo Telegram

Bot privado para acompanhar ofertas de Nintendo Switch 2 agora e outras listas no futuro.

Ele roda em Cloudflare Workers com D1. O Telegram recebe no máximo três alertas por régua em cada busca. A busca planejada roda a cada hora.

O projeto não contém API keys, tokens, senhas ou dados pessoais.

## O que já está pronto

- Banco D1 com tenant, regras, fontes, ofertas, histórico, alertas, quarentena e destinos.
- Quatro réguas iniciais: consoles e bundles, jogos físicos e colecionáveis, periféricos e jogos digitais pausados.
- Comandos do Telegram: `/adicionar`, `/regras`, `/editar`, `/pausar`, `/remover`, `/agora`, `/ofertas`, `/fontes`, `/status`, `/quarentena` e `/conectar_ml`.
- Filtros de preço, queda, mediana de 30 dias, novo menor preço, duplicatas e top 3 por régua.
- Filtro de usados: foto, descrição mínima, termos de risco, reputação, garantia, nota fiscal e quarentena para preço suspeito.
- Mercado Livre por OAuth: o token é renovado automaticamente e guardado criptografado no D1. As buscas usam os termos de cada régua, não apenas o nome genérico dela.
- Coletor Playwright separado para fontes liberadas e com URL de busca cadastrada.
- Conector opcional para GPT-5.6 Luna, desligado por padrão.

## Fontes e permissão

Todas as fontes começam como `pending`. Nenhuma coleta automática roda até registrar a permissão e trocar o estado para `active`.

O projeto dá prioridade a API, feed autorizado ou HTML público permitido. Ele não tenta passar por CAPTCHA, bloqueio, login, 401, 403 ou 429.

| Grupo | Fontes cadastradas | Caminho para ativação |
| --- | --- | --- |
| API conectada | Mercado Livre | OAuth oficial, já ativo. |
| API ou parceria | Amazon Brasil, Shopee Brasil, AliExpress Brasil, Eneba | Credenciais aprovadas pelo respectivo programa. |
| Rastreadores digitais | Nintendo eShop — Ofertas oficiais, NT Deals Brasil e PSPrices Brasil | Região Brasil e Switch/Switch 2. Aguardar revisão de termos, `robots.txt` ou feed permitido. |
| HTML público sujeito a revisão | Nintendo Brasil, KaBuM!, Magalu, Fast Shop, Casas Bahia, Ponto, Americanas, Carrefour, Gamer Hut, TK Fortini, ShopB, MeuGameUsado, Zoom, Buscapé, GameHunter e SetupBarato | Revisão documentada de termos e `robots.txt`, seguida de ativação no D1. |
| Manual ou parceria | Pelando, Promobit, NintenDrops e Nintendo Barato | Feed permitido, parceria ou conteúdo encaminhado pelo administrador. |
| Bloqueada por padrão | OLX | Autorização formal da OLX ou fonte licenciada. Não há crawling automático. |

O catálogo inteiro aparece em `/fontes`, com o estado e a condição de ativação. Uma fonte `pending` ou `blocked` continua no radar de configuração, mas não recebe coleta até que exista uma via permitida.

Quando uma fonte ativa retornar `401`, `403` ou `429`, o Radar muda seu estado para `blocked` e não repete a coleta. A retomada exige uma via permitida e uma revisão manual.

## Formato dos alertas

O Telegram recebe um alerta curto, sem copiar mensagens de outros canais:

```text
[Mercado Livre] Produto e edição
Cupom: ...
Loja/vendedor: ...
PIX: R$ ...
À vista: R$ ...
Frete: ...
Resumo: ...
Motivo: preço abaixo do teto
Verificado: data e hora
```

O alerta inclui botões para abrir o anúncio e, quando confirmado, o trailer oficial. O Radar limita cada régua a três alertas bem classificados por busca para evitar excesso de mensagens.

## Segurança: Cubo de McCumber

Leia [SECURITY.md](SECURITY.md). Ele cobre confidencialidade, integridade, disponibilidade e a proteção dos dados em repouso, trânsito e uso.

## Rodar localmente

Requer Node.js 22 ou superior.

```powershell
npm install
npm run typecheck
npm test
```

Crie um banco D1 no Cloudflare e substitua somente o identificador em `wrangler.toml`.

```powershell
npx wrangler d1 create radar-ofertas-db
npm run db:remote
```

Crie os segredos diretamente no Cloudflare. Não os inclua em `.env.example`.

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put OWNER_TELEGRAM_USER_ID
npx wrangler secret put COLLECTOR_SHARED_SECRET
npx wrangler secret put MELI_CLIENT_ID
npx wrangler secret put MELI_CLIENT_SECRET
npx wrangler secret put MELI_TOKEN_ENCRYPTION_KEY
```

Publique o Worker e configure o webhook com o segredo criado.

```powershell
npm run deploy
```

No DevCenter do Mercado Livre, cadastre como Redirect URI:

```text
https://SEU-WORKER.workers.dev/oauth/mercadolivre/callback
```

Se o DevCenter exigir a URL de notificações ao selecionar o tópico `items`, cadastre:

```text
https://SEU-WORKER.workers.dev/webhooks/mercadolivre
```

Nesta versão, a rota apenas confirma o recebimento. As buscas de ofertas seguem o cron horário.

Depois da publicação e dos três Secrets, use `/conectar_ml` no Telegram. O token de renovação é criptografado antes de ser salvo no D1. Em seguida, envie `/agora` para testar a primeira busca.

## GitHub Actions

O arquivo `.github/workflows/collector.yml` fica desligado até você criar a variável `COLLECTOR_ENABLED=true` e os segredos `COLLECTOR_BASE_URL` e `COLLECTOR_SHARED_SECRET` no GitHub.

O agendamento é horário, no minuto 17. Use apenas para fontes cuja permissão foi registrada e cujo estado no D1 esteja como `active`.

## GPT-5.6 Luna

O valor padrão é `GPT_ANALYSIS_ENABLED=false`. Sem chave da OpenAI, o bot funciona com alertas padronizados.

Quando você decidir ativar o recurso, crie uma chave exclusiva para o bot, adicione-a somente como segredo do Cloudflare e mantenha o teto mensal configurado em US$ 2. O conector pede JSON curto para resumo, edição, condição, acessórios e sinais de risco. Ele não recebe ferramentas e não calcula preço, descontos ou ranking.

## Publicação no GitHub

Antes do primeiro envio, revise arquivos rastreados e rode os testes:

```powershell
git init
git add .
git diff --cached --check
git status
git commit -m "feat: cria radar configurável de ofertas"
```

Crie o repositório como público apenas depois de conferir que `git status` não mostra `.env`, `.dev.vars`, `node_modules`, `.wrangler` ou qualquer arquivo com credenciais.
