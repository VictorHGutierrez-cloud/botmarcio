# ⚡ Guia Rápido - Deploy do Serviço de Renderização

## 📋 Resumo em 5 Passos

### 1️⃣ **Criar Novo Projeto no Railway**
- Acesse: https://railway.app
- Clique em **"New Project"**
- Escolha **"Deploy from GitHub repo"**
- Selecione o mesmo repositório do bot
- Nome: `render-service`

### 2️⃣ **Configurar o Serviço**
No painel do Railway, vá em **Settings**:
- **Root Directory**: Deixe vazio
- **Start Command**: `node render-service.js`
- **Build Command**: Deixe vazio

### 3️⃣ **Configurar FFmpeg**
No Railway, vá em **Settings** → **Buildpacks** → Adicione:
```
https://github.com/jonathanong/heroku-buildpack-ffmpeg-latest.git
```

**OU** crie arquivo `nixpacks.toml` na raiz:
```toml
[phases.setup]
nixPkgs = ["ffmpeg"]

[phases.install]
cmds = ["npm install"]
```

### 4️⃣ **Obter URL do Serviço**
Após o deploy:
- Vá em **Settings** → **Networking**
- Clique em **"Generate Domain"**
- Copie a URL (exemplo: `render-service-production.up.railway.app`)

### 5️⃣ **Configurar no Bot Principal**
No projeto do **Bot Principal** no Railway:
- Vá em **Variables**
- Adicione:
  ```
  RENDER_SERVICE_URL=https://render-service-production.up.railway.app
  ```
  (Substitua pela URL real do seu serviço)

---

## ✅ Pronto!

Agora o bot vai:
1. Baixar vídeo da Shopee
2. Enviar para o serviço de renderização
3. Receber vídeo em 720p sem marca d'água
4. Enviar para o usuário

---

## 🧪 Testar

### Testar Serviço de Renderização:
```bash
curl https://render-service-production.up.railway.app/health
```

Deve retornar:
```json
{"status":"ok","service":"render-service","version":"1.0.0"}
```

### Testar no Bot:
Envie um link da Shopee para o bot e veja se funciona!

---

## 🚨 Problemas Comuns

### "FFmpeg not found"
- Verifique se o buildpack foi adicionado
- Ou se o nixpacks.toml está correto

### "Port already in use"
- Railway define PORT automaticamente
- O código já usa `process.env.PORT`

### "Request timeout"
- Vídeos grandes podem demorar
- Timeout está em 5 minutos (300000ms)

---

## 📞 Precisa de Ajuda?

Me avise se:
- Deploy não funcionou
- Serviço não responde
- Erro ao processar vídeo
- Qualquer outro problema!

