# 🚂 Como Fazer Deploy de Serviço de Renderização no Railway

## 📋 Visão Geral

Você terá **2 serviços no Railway**:
1. **Bot Principal** (já existe) - Baixa vídeos e envia para usuários
2. **Serviço de Renderização** (novo) - Processa vídeos (720p + remove marca d'água)

---

## 🎯 Passo 1: Criar o Serviço de Renderização

### 1.1 Criar Arquivo do Serviço

Crie um arquivo `render-service.js` na raiz do projeto:

```javascript
const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ 
  dest: 'uploads/',
  limits: { fileSize: 100 * 1024 * 1024 } // 100MB max
});

// Criar diretórios necessários
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('outputs')) fs.mkdirSync('outputs');

app.use(express.json());

// Endpoint de saúde
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'render-service' });
});

// Endpoint principal: renderizar vídeo em 720p e remover marca d'água
app.post('/render', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum vídeo enviado' });
  }

  const inputPath = req.file.path;
  const outputPath = path.join('outputs', `${Date.now()}_rendered.mp4`);
  const tempPath = path.join('outputs', `${Date.now()}_temp.mp4`);

  console.log(`📥 Processando vídeo: ${req.file.originalname}`);
  console.log(`📐 Tamanho original: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

  try {
    // Obter informações do vídeo
    const videoInfo = await getVideoInfo(inputPath);
    const { width, height, duration } = videoInfo;
    
    console.log(`📊 Resolução original: ${width}x${height}`);
    console.log(`⏱️ Duração: ${duration}s`);

    // Calcular nova resolução mantendo aspect ratio (máximo 720p)
    const maxWidth = 1280;
    const maxHeight = 720;
    let newWidth = width;
    let newHeight = height;

    if (width > maxWidth || height > maxHeight) {
      const aspectRatio = width / height;
      if (width > height) {
        newWidth = maxWidth;
        newHeight = Math.round(maxWidth / aspectRatio);
        if (newHeight > maxHeight) {
          newHeight = maxHeight;
          newWidth = Math.round(maxHeight * aspectRatio);
        }
      } else {
        newHeight = maxHeight;
        newWidth = Math.round(maxHeight * aspectRatio);
        if (newWidth > maxWidth) {
          newWidth = maxWidth;
          newHeight = Math.round(maxWidth / aspectRatio);
        }
      }
    }

    // Garantir dimensões pares (necessário para H.264)
    newWidth = newWidth % 2 === 0 ? newWidth : newWidth - 1;
    newHeight = newHeight % 2 === 0 ? newHeight : newHeight - 1;

    console.log(`🎬 Renderizando em: ${newWidth}x${newHeight}`);

    // Calcular posição da marca d'água (canto inferior direito)
    const logoSize = Math.min(newWidth, newHeight) * 0.15;
    const x = newWidth - logoSize - 10;
    const y = newHeight - logoSize - 10;

    // Processar vídeo: redimensionar + remover marca d'água
    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters([
          {
            filter: 'scale',
            options: {
              w: newWidth,
              h: newHeight
            }
          },
          {
            filter: 'delogo',
            options: {
              x: Math.round(x),
              y: Math.round(y),
              w: Math.round(logoSize),
              h: Math.round(logoSize),
              show: 0
            }
          }
        ])
        .videoCodec('libx264')
        .audioCodec('aac')
        .outputOptions([
          '-preset medium',
          '-crf 20',
          '-movflags +faststart',
          '-pix_fmt yuv420p',
          '-profile:v high',
          '-level 4.0',
          '-b:a 192k'
        ])
        .on('start', (commandLine) => {
          console.log('🚀 FFmpeg iniciado');
        })
        .on('progress', (progress) => {
          if (progress.percent) {
            console.log(`⏳ Progresso: ${Math.round(progress.percent)}%`);
          }
        })
        .on('end', () => {
          console.log('✅ Renderização concluída!');
          resolve();
        })
        .on('error', (err) => {
          console.error('❌ Erro no FFmpeg:', err);
          reject(err);
        })
        .save(outputPath);
    });

    // Verificar tamanho do arquivo final
    const stats = fs.statSync(outputPath);
    const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
    console.log(`📦 Arquivo final: ${fileSizeMB} MB`);

    // Enviar arquivo
    res.download(outputPath, 'video_rendered.mp4', (err) => {
      // Limpar arquivos temporários
      setTimeout(() => {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
      }, 5000);
    });

  } catch (error) {
    console.error('❌ Erro ao processar vídeo:', error);
    res.status(500).json({ error: error.message });
    
    // Limpar arquivos em caso de erro
    if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
});

// Função auxiliar para obter informações do vídeo
function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      resolve({
        width: videoStream.width,
        height: videoStream.height,
        duration: metadata.format.duration
      });
    });
  });
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 Serviço de renderização rodando na porta ${PORT}`);
});
```

### 1.2 Criar package.json para o Serviço

Crie um arquivo `render-service-package.json` (ou adicione ao package.json existente):

```json
{
  "name": "render-service",
  "version": "1.0.0",
  "main": "render-service.js",
  "scripts": {
    "start": "node render-service.js"
  },
  "dependencies": {
    "express": "^4.18.2",
    "multer": "^1.4.5-lts.1",
    "fluent-ffmpeg": "^2.1.3"
  }
}
```

---

## 🚂 Passo 2: Deploy no Railway

### 2.1 Criar Novo Projeto no Railway

1. Acesse: https://railway.app
2. Clique em **"New Project"**
3. Selecione **"Deploy from GitHub repo"**
4. Escolha o mesmo repositório do bot
5. Dê um nome: `render-service` ou `shopee-renderer`

### 2.2 Configurar o Serviço

No painel do Railway:

1. **Settings** → **Root Directory**: Deixe vazio (raiz do projeto)
2. **Settings** → **Start Command**: `node render-service.js`
3. **Settings** → **Build Command**: Deixe vazio (ou `npm install` se necessário)

### 2.3 Variáveis de Ambiente

No Railway, adicione:
- `PORT` = `5000` (ou deixe Railway definir automaticamente)
- `NODE_ENV` = `production`

### 2.4 Configurar FFmpeg

O Railway precisa do FFmpeg instalado. Adicione um arquivo `railway.json` ou configure no **Settings**:

**Opção A: Usar Buildpack do FFmpeg**

No Railway, vá em **Settings** → **Buildpacks** → Adicione:
```
https://github.com/jonathanong/heroku-buildpack-ffmpeg-latest.git
```

**Opção B: Instalar via nixpacks.toml**

Crie arquivo `nixpacks.toml`:
```toml
[phases.setup]
nixPkgs = ["ffmpeg"]

[phases.install]
cmds = ["npm install"]
```

---

## 🔗 Passo 3: Conectar os Dois Serviços

### 3.1 Obter URL do Serviço de Renderização

No Railway, após o deploy:
1. Vá em **Settings** → **Networking**
2. Clique em **"Generate Domain"**
3. Copie a URL (exemplo: `render-service-production.up.railway.app`)

### 3.2 Configurar no Bot Principal

No projeto do **Bot Principal** no Railway, adicione variável de ambiente:

```
WATERMARK_REMOVAL_LOCAL_URL=https://render-service-production.up.railway.app
```

Ou se preferir usar o endpoint específico:

```
RENDER_SERVICE_URL=https://render-service-production.up.railway.app
```

### 3.3 Atualizar shopee-downloader.js

O código já está preparado! Ele vai:
1. Tentar usar `WATERMARK_REMOVAL_LOCAL_URL` se configurado
2. Fazer fallback para FFmpeg local se falhar

---

## 📝 Passo 4: Estrutura de Arquivos

Sua estrutura deve ficar assim:

```
projeto/
├── bot.js                    # Bot principal
├── shopee-downloader.js      # Downloader (já atualizado)
├── render-service.js         # NOVO: Serviço de renderização
├── package.json              # Dependências do bot
├── render-service-package.json  # OU adicione ao package.json principal
├── nixpacks.toml             # Configuração FFmpeg (opcional)
└── ...
```

---

## 🎯 Passo 5: Testar

### 5.1 Testar Serviço de Renderização

```bash
# Localmente (antes de fazer deploy)
node render-service.js

# Em outro terminal
curl -X POST http://localhost:5000/health
# Deve retornar: {"status":"ok","service":"render-service"}
```

### 5.2 Testar Integração

No bot, envie um vídeo da Shopee. O bot deve:
1. Baixar o vídeo
2. Enviar para o serviço de renderização
3. Receber vídeo processado (720p, sem marca d'água)
4. Enviar para o usuário

---

## 💡 Dicas Importantes

### 1. Custos
- Railway cobra por uso de recursos
- Serviço de renderização usa mais CPU/memória
- Monitore o uso no dashboard do Railway

### 2. Timeout
- Vídeos grandes podem demorar
- Configure timeout adequado no bot (já está em 5 minutos)

### 3. Limpeza
- O serviço limpa arquivos temporários automaticamente
- Mas monitore o espaço em disco

### 4. Escalabilidade
- Se tiver muitos usuários, considere fila (Redis/Bull)
- Ou limite de requisições simultâneas

---

## 🚨 Troubleshooting

### Erro: "FFmpeg not found"
- Configure o buildpack ou nixpacks.toml
- Verifique se FFmpeg está instalado no Railway

### Erro: "Port already in use"
- Railway define PORT automaticamente
- Use `process.env.PORT` no código

### Erro: "Request timeout"
- Aumente timeout no bot
- Otimize processamento (preset faster)

### Vídeo não renderiza
- Verifique logs no Railway
- Teste endpoint `/health` primeiro

---

## ✅ Checklist Final

- [ ] Criar `render-service.js`
- [ ] Adicionar dependências ao `package.json`
- [ ] Criar novo projeto no Railway
- [ ] Configurar buildpack/nixpacks para FFmpeg
- [ ] Fazer deploy
- [ ] Obter URL do serviço
- [ ] Configurar `WATERMARK_REMOVAL_LOCAL_URL` no bot
- [ ] Testar integração
- [ ] Monitorar uso e custos

---

## 📞 Próximos Passos

Depois de configurar, me avise se:
- Deploy funcionou
- Serviço está respondendo
- Integração está funcionando
- Algum erro apareceu

Posso ajudar a ajustar qualquer coisa!

