# Radar de ofertas Mercado Livre e Amazon pelo Telegram

Bot configurável para pesquisar produtos no Mercado Livre e na Amazon Brasil a cada hora.

O foco inicial é Nintendo Switch 2. Você pode trocar as réguas pelo Telegram para pesquisar qualquer item.

O Worker roda no Cloudflare 24 horas por dia. Seu computador pode ficar desligado.

## Fontes automáticas

### Mercado Livre

O Radar usa OAuth e a API oficial do Mercado Livre.

Ele tenta a busca de anúncios. Se esse recurso responder 403, usa a busca de catálogo e a oferta vencedora do produto.

Os links retornados pela API são links normais do produto. O programa Mercado Livre Afiliados documenta a criação de links pela Central ou Barra de Afiliados, mas não publica uma API para transformar links automaticamente. O Radar não acessa recursos privados do portal.

Documentação:

- [Itens e buscas](https://developers.mercadolivre.com.br/itens-e-buscas)
- [Buscador de produtos](https://developers.mercadolivre.com.br/buscador-de-produtos)
- [Gerador de links de afiliado](https://www.mercadolivre.com.br/l/afiliados-gere-seus-links)

### Amazon Brasil

O Radar usa a Amazon Creators API, sucessora da PA-API 5.0.

A API pesquisa por palavras-chave, informa preço, desconto, condição, estoque, vendedor e imagem. O `detailPageURL` já contém a tag do Associado.

Documentação:

- [Cadastro na Creators API](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/onboarding/register-for-creators-api)
- [Busca de produtos](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/api-reference/operations/search-items)
- [Autenticação OAuth](https://affiliate-program.amazon.com/creatorsapi/docs/en-us/get-started/using-curl)

A Amazon exige aprovação final no programa e vendas qualificadas antes de liberar a Creators API.

## Fluxo horário

1. O Cloudflare inicia a busca no minuto 17 de cada hora.
2. O bot reúne até 12 termos únicos das réguas ativas.
3. As duas APIs pesquisam esses termos.
4. O código normaliza produto, edição, condição, preço e desconto.
5. O D1 guarda o histórico.
6. O Telegram recebe até três alertas por régua.

Não há Playwright, scraping, CAPTCHA, cookie de navegador ou coleta manual.

## Alertas

O bot dispara quando encontra:

- Desconto anunciado de pelo menos 5%.
- Preço abaixo do teto da régua.
- Queda de pelo menos 5% no mesmo anúncio.
- Preço 10% abaixo da mediana de 30 dias.
- Novo menor preço registrado.
- Usado ou seminovo aprovado pelo filtro de qualidade.

O mesmo anúncio só volta após 24 horas ou nova queda de 5%.

Exemplo:

```text
[Amazon Brasil] Zelda edição de colecionador
Loja/vendedor: Amazon.com.br
À vista: R$ 449,90
Preço anterior: R$ 599,90
Desconto: 25%
Motivo: desconto anunciado de 25%
```

## Comandos

- `/adicionar`: cria uma régua.
- `/regras`: lista as réguas.
- `/editar`: muda nome, termos e teto.
- `/pausar`: pausa uma régua.
- `/remover`: remove uma régua.
- `/agora`: executa uma busca.
- `/ofertas`: mostra ofertas recentes.
- `/fontes`: mostra Mercado Livre e Amazon.
- `/status`: mostra conexão das APIs.
- `/quarentena`: mostra anúncios suspeitos.
- `/conectar_ml`: autoriza o Mercado Livre.

## Tecnologias

| Tecnologia | Uso |
| --- | --- |
| TypeScript | Worker, Telegram, APIs, filtros e histórico. |
| SQL | Banco D1 e mudanças de estrutura. |
| TOML | Worker, banco e cron. |
| YAML | Testes automáticos no GitHub Actions. |

## Copiar para sua conta

### 1. Clone

```powershell
git clone https://github.com/DATAdotPDF/radar-ofertas-telegram.git
cd radar-ofertas-telegram
npm install
npm run typecheck
npm test
```

O projeto usa a licença MIT.

### 2. Crie seu bot

Abra o BotFather no Telegram e use `/newbot`. Guarde o token fora do Git.

### 3. Prepare o Cloudflare

```powershell
npx wrangler login
npx wrangler d1 create radar-ofertas-db
```

Copie o `database_id` recebido para `wrangler.toml`. Troque o nome do Worker.

```powershell
npm run db:remote
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npm run deploy
```

Copie a URL publicada para `WORKER_PUBLIC_URL` no `wrangler.toml` e publique outra vez.

Abra `https://SEU-WORKER.workers.dev/health`. Envie uma mensagem ao bot. Sem proprietário definido, ele informa seu ID numérico.

```powershell
npx wrangler secret put OWNER_TELEGRAM_USER_ID
npm run deploy
```

### 4. Mercado Livre

Crie um aplicativo no DevCenter e use estas URLs:

```text
https://SEU-WORKER.workers.dev/oauth/mercadolivre/callback
https://SEU-WORKER.workers.dev/webhooks/mercadolivre
```

Cadastre:

```powershell
npx wrangler secret put MELI_CLIENT_ID
npx wrangler secret put MELI_CLIENT_SECRET
npx wrangler secret put MELI_TOKEN_ENCRYPTION_KEY
```

Envie `/conectar_ml` ao bot e conclua a autorização.

### 5. Amazon

Entre no Amazon Associados Brasil. Após a aprovação final, abra `Ferramentas` e `Creators API`. Crie um aplicativo e uma credencial.

Cadastre:

```powershell
npx wrangler secret put AMAZON_CREATORS_CREDENTIAL_ID
npx wrangler secret put AMAZON_CREATORS_CREDENTIAL_SECRET
npx wrangler secret put AMAZON_ASSOCIATE_TAG
```

A versão brasileira usa o endpoint de credencial `3.1`. O código assume esse valor. Se sua credencial mostrar outra versão:

```powershell
npx wrangler secret put AMAZON_CREATORS_CREDENTIAL_VERSION
```

Publique novamente. A fonte Amazon muda de `pending` para `active` na próxima busca.

### 6. Troque os produtos

No Telegram:

```text
/adicionar
```

O bot pede nome, termos separados por vírgula e teto. Exemplo:

```text
Nome: Notebook Ryzen
Termos: notebook ryzen 7, notebook 32gb ram, notebook oled
Teto: 4500,00
```

As duas APIs passam a pesquisar esses termos a cada hora.

## Execução 24/7

O `wrangler.toml` contém:

```toml
[triggers]
crons = ["17 * * * *"]
```

Use `/agora` para testar sem esperar o próximo horário.

## GPT opcional

`GPT_ANALYSIS_ENABLED=false` mantém Luna desligado. Nenhuma chave OpenAI é necessária.

## Segurança

Leia [SECURITY.md](SECURITY.md).

- Segredos ficam no Cloudflare.
- `.env`, `.dev.vars`, tokens e dependências ficam fora do Git.
- Tokens OAuth do Mercado Livre ficam criptografados no D1.
- A Amazon usa OAuth com token de uma hora.
- O bot não acessa portais privados nem tenta contornar recusas.

Antes de publicar:

```powershell
npm run typecheck
npm test
git diff --check
git status
```
