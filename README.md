# Radar configurável de ofertas pelo Telegram

Bot privado para acompanhar ofertas de Nintendo Switch 2 agora e outras listas no futuro.

Ele roda em Cloudflare Workers com D1. O Telegram recebe no máximo três alertas por régua em cada busca. A busca planejada roda a cada hora.

O projeto não contém API keys, tokens, senhas ou dados pessoais.

## O que já está pronto

- Banco D1 com tenant, regras, fontes, ofertas, histórico, alertas, quarentena e destinos.
- Quatro réguas iniciais: consoles e bundles, jogos físicos e colecionáveis, periféricos e jogos digitais pausados.
- Comandos do Telegram: `/adicionar`, `/regras`, `/editar`, `/pausar`, `/remover`, `/agora`, `/ofertas`, `/fontes`, `/status` e `/quarentena`.
- Filtros de preço, queda, mediana de 30 dias, novo menor preço, duplicatas e top 3 por régua.
- Filtro de usados: foto, descrição mínima, termos de risco, reputação, garantia, nota fiscal e quarentena para preço suspeito.
- Mercado Livre preparado pela API pública.
- Coletor Playwright separado para fontes liberadas e com URL de busca cadastrada.
- Conector opcional para GPT-5.6 Luna, desligado por padrão.

## Fontes e permissão

Todas as fontes começam como `pending`. Nenhuma coleta automática roda até registrar a permissão e trocar o estado para `active`.

O projeto dá prioridade a API, feed autorizado ou HTML público permitido. Ele não tenta passar por CAPTCHA, bloqueio, login, 401, 403 ou 429.

OLX fica preparada, sem coleta automática. A Amazon só entra após aprovação da Creators API. Fontes de promoções entram por parceria, feed permitido ou conteúdo encaminhado.

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
```

Publique o Worker e configure o webhook com o segredo criado.

```powershell
npm run deploy
```

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
