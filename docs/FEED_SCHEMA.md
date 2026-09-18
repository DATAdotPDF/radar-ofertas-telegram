# Contrato do feed JSON autorizado

Use este formato para conectar uma loja, afiliado ou parceiro que permita consumo automático.

```json
{
  "offers": [
    {
      "externalId": "SKU-123",
      "title": "Nintendo Switch 2",
      "description": "Produto novo e lacrado",
      "url": "https://loja.exemplo.com/produtos/SKU-123",
      "imageUrl": "https://loja.exemplo.com/imagens/SKU-123.jpg",
      "imageAuthorized": true,
      "sellerName": "Loja Exemplo",
      "sellerReputation": 95,
      "officialStore": true,
      "condition": "new",
      "priceCents": 249900,
      "pixPriceCents": 239900,
      "installmentText": "10x de R$ 249,90",
      "shippingText": "frete grátis",
      "couponText": "CUPOM10",
      "stockStatus": "in_stock",
      "trailerUrl": "https://www.youtube.com/watch?v=exemplo",
      "warranty": true,
      "invoice": true
    }
  ]
}
```

Campos obrigatórios:

- `externalId`: identificador estável da oferta.
- `title`: nome do produto.
- `url`: endereço HTTPS do anúncio.
- `priceCents`: preço inteiro em centavos. Também é aceito `price` em reais.

Limites:

- HTTPS obrigatório.
- Host presente em `AUTHORIZED_FEED_HOSTS`.
- Resposta de até 2 MB.
- Até 500 itens por resposta.
- O Radar ignora itens inválidos.
- Imagens só aparecem quando a fonte e o item autorizam o uso.

Exemplo de cadastro no D1:

```sql
UPDATE source_configs
SET name = 'Minha loja',
    kind = 'api',
    status = 'active',
    search_url_template = 'https://feeds.minhaloja.com.br/ofertas?q={query}',
    policy_url = 'https://feeds.minhaloja.com.br/termos',
    image_authorized = 1,
    notes = 'Feed autorizado pelo fornecedor.'
WHERE id = 'authorized-json-feed' AND tenant_id = 'default';
```

Configure também:

```text
AUTHORIZED_FEED_HOSTS=feeds.minhaloja.com.br
```

Separe vários hosts com vírgula. Não inclua protocolo, caminho, porta, usuário ou senha.
