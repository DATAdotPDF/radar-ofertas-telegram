# Radar configurável de ofertas pelo Telegram

Bot pessoal para encontrar ofertas, quedas de preço, novos menores preços e anúncios usados de boa qualidade.

O foco inicial é Nintendo Switch 2. As réguas podem ser trocadas pelo Telegram para pesquisar qualquer produto.

O Worker roda na nuvem a cada hora. Seu computador pode ficar desligado.

## Estado deste repositório

- Bot do Telegram com comandos privados para o administrador.
- Quatro réguas ativas: console e bundles, jogos físicos, acessórios e jogos digitais.
- Até três alertas por régua em cada busca.
- Histórico de preços, mediana de 30 dias, queda de 5% e menor preço.
- Filtro de usados e seminovos com nota mínima e quarentena.
- Mercado Livre por OAuth. A fonte pode ficar pausada quando a API responder 401, 403 ou 429.
- Conector genérico para APIs e feeds JSON autorizados.
- Coletor com Playwright para páginas que aceitem navegação automática.
- GPT-5.6 Luna preparado e desligado por padrão.
- Testes automáticos em cada envio ao GitHub.

O serviço horário fica ativo 24/7. Alertas dependem de ao menos uma fonte ativa que devolva ofertas válidas.

## Como funciona

1. O agendamento do Cloudflare inicia uma busca no minuto 17 de cada hora.
2. O Worker consulta APIs e feeds ativos.
3. O GitHub Actions pode consultar páginas liberadas com Playwright no mesmo horário.
4. O bot normaliza título, preço, condição, vendedor e frete.
5. O D1 guarda o histórico e compara produtos equivalentes.
6. O Telegram recebe as três melhores ofertas de cada régua.

Console simples não é comparado com bundle. Edição comum não é comparada com edição de colecionador.

## Gatilhos de alerta

- Preço abaixo do teto da régua.
- Queda de pelo menos 5%.
- Preço 10% abaixo da mediana de 30 dias.
- Novo menor preço registrado.
- Novo usado ou seminovo com nota mínima de 70.

O mesmo anúncio só volta após nova queda de 5% ou 24 horas.

## Comandos do Telegram

- `/adicionar`: cria uma régua.
- `/regras`: lista réguas e identificadores.
- `/editar`: muda nome, termos e teto.
- `/pausar`: pausa uma régua.
- `/remover`: remove uma régua.
- `/agora`: executa a busca.
- `/ofertas`: mostra ofertas recentes.
- `/fontes`: mostra o estado das fontes.
- `/status`: mostra saúde do radar.
- `/quarentena`: mostra anúncios suspeitos.
- `/conectar_ml`: abre a autorização do Mercado Livre.

## Fontes

O catálogo inclui Mercado Livre, Amazon, OLX, KaBuM!, Magalu, Fast Shop, Casas Bahia, Ponto, Americanas, Shopee, Carrefour, AliExpress, Eneba, Gamer Hut, TK Fortini, ShopB, MeuGameUsado, Zoom, Buscapé, GameHunter, SetupBarato, NT Deals, PSPrices, Nintendo Brasil, Pelando, Promobit, NintenDrops e Nintendo Barato.

Cada fonte possui um estado:

- `pending`: aguarda API, feed ou revisão de acesso.
- `active`: participa das buscas automáticas.
- `paused`: parou após recusa, limite ou decisão do administrador.
- `blocked`: reservado para bloqueio manual.

NT Deals e PSPrices apresentaram desafio anti-bot durante a revisão. Eles continuam como `pending`. Nintendo Brasil serve como referência oficial manual. OLX aguarda API, feed licenciado ou autorização.

O Radar não resolve CAPTCHA, não reaproveita cookies privados e não tenta passar por 401, 403 ou 429. Nesses casos, pausa a fonte para você revisar.

NintenDrops é apenas referência de formato. O projeto não copia mensagens nem coleta seu grupo.

## Feed JSON autorizado

Lojas e parceiros podem fornecer um feed simples. O Radar aceita apenas HTTPS e hosts presentes em `AUTHORIZED_FEED_HOSTS`.

Exemplo curto:

```json
{
  "offers": [
    {
      "externalId": "SKU-123",
      "title": "Nintendo Switch 2",
      "url": "https://loja.exemplo.com/SKU-123",
      "priceCents": 249900,
      "condition": "new"
    }
  ]
}
```

Veja campos, limites e cadastro em [docs/FEED_SCHEMA.md](docs/FEED_SCHEMA.md).

## Linguagens e arquivos

| Tecnologia | Uso |
| --- | --- |
| TypeScript | Worker, Telegram, filtros, banco e conectores. |
| SQL | Estrutura e mudanças do banco D1. |
| JavaScript | Coletor Playwright executado pelo GitHub Actions. |
| TOML | Configuração do Worker e do cron. |
| YAML | CI e coletor horário no GitHub Actions. |

Node.js 22 executa testes e ferramentas locais. Cloudflare Workers executa o bot publicado.

## Copiar e configurar para você

### 1. Copie o repositório

Você pode usar o botão `Fork` do GitHub ou clonar:

```powershell
git clone https://github.com/DATAdotPDF/radar-ofertas-telegram.git
cd radar-ofertas-telegram
npm install
npm run typecheck
npm test
```

O código usa a licença MIT. Você pode copiar, adaptar e publicar mantendo o aviso da licença.

### 2. Crie o bot no Telegram

Abra o BotFather, use `/newbot` e guarde o token. Não salve o token no Git.

### 3. Prepare o Cloudflare

Entre na sua conta e autorize a ferramenta:

```powershell
npx wrangler login
npx wrangler d1 create radar-ofertas-db
```

Copie o `database_id` recebido para `wrangler.toml`. Troque também o nome do Worker para evitar conflito.

Aplique o banco:

```powershell
npm run db:remote
```

### 4. Cadastre segredos

Crie valores fortes e diferentes. O comando pede o valor sem gravá-lo no repositório.

```powershell
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put COLLECTOR_SHARED_SECRET
```

Publique a primeira versão:

```powershell
npm run deploy
```

Copie a URL exibida pelo Cloudflare para `WORKER_PUBLIC_URL` em `wrangler.toml` e publique outra vez.

Abra no navegador:

```text
https://SEU-WORKER.workers.dev/health
```

Isso registra o webhook do Telegram. Envie uma mensagem ao bot. Sem um proprietário configurado, ele informa seu ID numérico.

Cadastre o ID e publique:

```powershell
npx wrangler secret put OWNER_TELEGRAM_USER_ID
npm run deploy
```

Envie `/start` e `/status` no Telegram.

### 5. Ligue fontes

Para Mercado Livre, cadastre também:

```powershell
npx wrangler secret put MELI_CLIENT_ID
npx wrangler secret put MELI_CLIENT_SECRET
npx wrangler secret put MELI_TOKEN_ENCRYPTION_KEY
```

No DevCenter do Mercado Livre, use:

```text
https://SEU-WORKER.workers.dev/oauth/mercadolivre/callback
https://SEU-WORKER.workers.dev/webhooks/mercadolivre
```

Depois envie `/conectar_ml` ao bot.

Para um feed JSON, configure a variável `AUTHORIZED_FEED_HOSTS` no Cloudflare e siga [docs/FEED_SCHEMA.md](docs/FEED_SCHEMA.md).

Mude uma fonte para `active` somente quando ela tiver URL válida e acesso confirmado.

### 6. Confirme o modo 24/7

O arquivo `wrangler.toml` contém:

```toml
[triggers]
crons = ["17 * * * *"]
```

Esse cron roda uma vez por hora no Cloudflare. Não depende do seu PC.

Confira no painel do Worker se o gatilho aparece em `Triggers`. Use `/agora` para um teste imediato.

## Coletor Playwright no GitHub

O arquivo `.github/workflows/collector.yml` também roda a cada hora. Ele só trabalha quando a variável do repositório `COLLECTOR_ENABLED` vale `true`.

Crie estes Secrets no GitHub:

- `COLLECTOR_BASE_URL`: URL pública do Worker.
- `COLLECTOR_SHARED_SECRET`: o mesmo valor guardado no Cloudflare.

O coletor lê apenas fontes `active`, do tipo `browser`, com `search_url_template`. Ele procura dados estruturados `Product` em JSON-LD. Ao encontrar CAPTCHA, 401, 403 ou 429, pausa a fonte e segue para a próxima.

## Formato do alerta

```text
[Loja] Produto e edição
Cupom: ...
Loja/vendedor: ...
PIX: R$ ...
À vista: R$ ...
Frete: ...
Resumo: ...
Motivo: preço abaixo do teto
Verificado: data e hora
```

O alerta pode incluir foto autorizada, link do anúncio e trailer oficial confirmado.

## GPT-5.6 Luna

`GPT_ANALYSIS_ENABLED=false` mantém o recurso desligado. Nenhuma chave OpenAI é exigida.

Quando ativado, Luna resume descrição, edição, condição, acessórios e sinais de risco. O código continua responsável por preço, desconto, mediana, ranking e duplicatas.

## Segurança

O projeto segue o Cubo de McCumber. Leia [SECURITY.md](SECURITY.md).

- Segredos ficam no Cloudflare ou GitHub Secrets.
- `.env`, `.dev.vars`, tokens, relatórios e dependências ficam fora do Git.
- O webhook do Telegram e as rotas internas exigem segredos distintos.
- O feed aceita apenas HTTPS e hosts liberados.
- Imagens permanecem por URL e só aparecem com permissão.

Antes de publicar uma mudança:

```powershell
npm run typecheck
npm test
git diff --check
git status
```

Nunca cole token, senha, cookie, chave ou URL assinada em issue, commit ou arquivo público.
