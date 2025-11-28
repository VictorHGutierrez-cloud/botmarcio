# 🔍 Como Investigar o Bot Concorrente

## Passo a Passo para Descobrir Como Eles Baixam Sem Marca D'água

### 1. Abrir o Bot no Telegram Web
1. Acesse: https://web.telegram.org/k/?swfix=1#@achadoshdfreebot
2. Abra o DevTools (F12 ou Ctrl+Shift+I)
3. Vá na aba **Network** (Rede)

### 2. Filtrar Requisições
1. No campo de filtro, digite: `mp4` ou `video` ou `shopee`
2. Ou deixe sem filtro para ver todas as requisições

### 3. Enviar um Link para o Bot
1. Envie um link da Shopee para o bot
2. Observe as requisições que aparecem na aba Network

### 4. O Que Procurar

#### A. URLs de Vídeo
- Procure por requisições que terminam em `.mp4` ou `.m3u8`
- Clique na requisição e veja:
  - **Headers** → Request Headers (veja os headers que eles enviam)
  - **Response** → veja a URL completa do vídeo
  - **Preview** → veja se é realmente o vídeo

#### B. Requisições da API da Shopee
- Procure por requisições que contenham:
  - `shopee.com.br/api`
  - `get_item_detail`
  - `video`
  - `media`
  
- Clique na requisição e veja:
  - **Headers** → especialmente:
    - `Cookie` (cookies de sessão)
    - `User-Agent`
    - `Referer`
    - `X-Requested-With`
  - **Payload** → se for POST, veja o que eles enviam
  - **Response** → veja o JSON retornado (pode ter a URL do vídeo sem marca d'água)

#### C. Cookies Importantes
- Vá em **Application** → **Cookies** → `https://shopee.com.br`
- Veja quais cookies estão presentes
- Anote especialmente:
  - `SPC_EC`
  - `SPC_F`
  - `SPC_SI`
  - `SPC_T`
  - Qualquer outro cookie relacionado a sessão

### 5. Informações para Me Passar

Quando encontrar algo interessante, me passe:

1. **URL do vídeo final** (a que eles baixam)
   - Exemplo: `https://cf.shopee.com.br/file/xxxxx.mp4`

2. **Headers da requisição** (especialmente):
   - User-Agent
   - Cookie
   - Referer
   - Qualquer header customizado

3. **URL da API** que retorna o vídeo
   - Exemplo: `https://shopee.com.br/api/v4/item/get?itemid=...`

4. **Resposta JSON da API** (se houver)
   - Copie o JSON completo ou pelo menos a parte com a URL do vídeo

5. **Diferenças visíveis**:
   - A URL do vídeo deles é diferente da nossa?
   - Eles usam um endpoint diferente?
   - Há parâmetros especiais na URL?

### 6. Dica Extra: Verificar o Código Fonte
- Vá na aba **Sources** ou **Sources**
- Procure por arquivos JavaScript que possam conter a lógica
- Procure por palavras-chave: `video`, `download`, `shopee`, `mp4`

---

## O Que Provavelmente Eles Fazem

Baseado no que você disse (removem marca d'água), eles provavelmente:

1. **Usam API privada da Shopee** (não a web pública)
2. **Têm cookies de sessão válidos** (usuário logado)
3. **Acessam endpoints específicos** que retornam vídeo original
4. **Usam headers específicos** que fazem a Shopee servir vídeo sem marca d'água

---

## Próximos Passos

Depois que você me passar essas informações, vou:
1. Atualizar o código para usar os mesmos endpoints/headers
2. Melhorar a interceptação de requisições
3. Adicionar suporte aos cookies corretos
4. Tentar replicar o comportamento deles

