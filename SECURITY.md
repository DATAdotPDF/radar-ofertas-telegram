# Segurança do projeto

Este projeto segue o Cubo de McCumber em toda mudança de código e de operação.

| Área | Regra no Radar |
| --- | --- |
| Confidencialidade | Chaves ficam em segredos do Cloudflare ou GitHub. Não entram em commits, mensagens, logs ou arquivos de exemplo. |
| Integridade | O Worker calcula preço, desconto, mediana, deduplicação e ranking. O GPT opcional não altera esses cálculos. |
| Disponibilidade | Uma API com falha não para a outra. O Worker registra o erro e pausa a fonte diante de 401, 403 ou 429. |
| Dados em repouso | D1 guarda somente dados públicos de ofertas, regras e histórico. Não salva cartões, senhas ou documentos. |
| Dados em trânsito | Webhook e APIs exigem HTTPS. O webhook do Telegram valida um segredo próprio. |
| Dados em uso | Só o `OWNER_TELEGRAM_USER_ID` pode administrar regras. O modelo recebe só conteúdo público e sem ferramentas. |

## Regras obrigatórias

- Nunca grave token, senha, chave, cookie ou URL assinada no repositório.
- Nunca copie imagem de terceiros. Guarde só a URL e envie imagem apenas quando a fonte autorizar.
- Use somente as APIs oficiais configuradas.
- Pare e pause a fonte ao receber 401, 403 ou 429. Não tente burlar controles.
- Nunca automatize o portal privado de afiliados do Mercado Livre.
- Use somente o `detailPageURL` devolvido pela Amazon Creators API.
- Revise dependências e resultados de testes antes de publicar.
- Se houver suspeita de chave exposta, revogue-a no provedor e remova o valor do ambiente. Não faça commit para "corrigir" o segredo.

## Relato de vulnerabilidade

Não abra uma issue pública com dados sensíveis. Avise o mantenedor por um canal privado e inclua só o necessário para reproduzir o problema.
