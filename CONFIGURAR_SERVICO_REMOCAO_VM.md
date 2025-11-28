# 🖥️ Como Configurar Serviço de Remoção de Marca D'água na VM

## 📋 Opções de Implementação

### Opção 1: Serviço Python com OpenCV (Recomendado)

#### 1. Instalar Dependências na VM

```bash
# Instalar Python e pip
sudo apt update
sudo apt install python3 python3-pip ffmpeg

# Instalar bibliotecas Python
pip3 install flask opencv-python numpy pillow requests
```

#### 2. Criar Serviço Python

Crie um arquivo `watermark_remover.py`:

```python
from flask import Flask, request, send_file
import cv2
import numpy as np
import tempfile
import os
from werkzeug.utils import secure_filename

app = Flask(__name__)

@app.route('/remove-watermark', methods=['POST'])
def remove_watermark():
    if 'video' not in request.files:
        return {'error': 'Nenhum vídeo enviado'}, 400
    
    video_file = request.files['video']
    
    # Salvar vídeo temporário
    temp_input = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
    temp_output = tempfile.NamedTemporaryFile(delete=False, suffix='.mp4')
    
    try:
        video_file.save(temp_input.name)
        
        # Processar vídeo com OpenCV
        cap = cv2.VideoCapture(temp_input.name)
        fourcc = cv2.VideoWriter_fourcc(*'mp4v')
        fps = int(cap.get(cv2.CAP_PROP_FPS))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        
        out = cv2.VideoWriter(temp_output.name, fourcc, fps, (width, height))
        
        # Remover marca d'água de cada frame
        while True:
            ret, frame = cap.read()
            if not ret:
                break
            
            # Remover marca d'água do canto inferior direito
            # (ajuste conforme necessário)
            h, w = frame.shape[:2]
            logo_size = int(min(w, h) * 0.15)
            x = w - logo_size - 10
            y = h - logo_size - 10
            
            # Usar inpainting para remover marca d'água
            mask = np.zeros((h, w), dtype=np.uint8)
            mask[y:y+logo_size, x:x+logo_size] = 255
            frame = cv2.inpaint(frame, mask, 3, cv2.INPAINT_TELEA)
            
            out.write(frame)
        
        cap.release()
        out.release()
        
        return send_file(temp_output.name, mimetype='video/mp4')
        
    finally:
        # Limpar arquivos temporários
        if os.path.exists(temp_input.name):
            os.unlink(temp_input.name)
        if os.path.exists(temp_output.name):
            os.unlink(temp_output.name)

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

#### 3. Executar Serviço

```bash
# Executar diretamente
python3 watermark_remover.py

# Ou usar systemd para rodar como serviço
sudo nano /etc/systemd/system/watermark-remover.service
```

Conteúdo do arquivo de serviço:
```ini
[Unit]
Description=Watermark Remover Service
After=network.target

[Service]
Type=simple
User=seu-usuario
WorkingDirectory=/caminho/para/servico
ExecStart=/usr/bin/python3 /caminho/para/servico/watermark_remover.py
Restart=always

[Install]
WantedBy=multi-user.target
```

Ativar serviço:
```bash
sudo systemctl enable watermark-remover
sudo systemctl start watermark-remover
```

---

### Opção 2: Serviço Node.js (Mais Simples)

#### 1. Criar Serviço Node.js

Crie um arquivo `watermark-service.js`:

```javascript
const express = require('express');
const multer = require('multer');
const ffmpeg = require('fluent-ffmpeg');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const app = express();
const upload = multer({ dest: 'uploads/' });

app.post('/remove-watermark', upload.single('video'), (req, res) => {
  const inputPath = req.file.path;
  const outputPath = path.join('outputs', `${Date.now()}.mp4`);
  
  // Criar diretório de saída se não existir
  if (!fs.existsSync('outputs')) {
    fs.mkdirSync('outputs');
  }
  
  // Obter informações do vídeo
  ffmpeg.ffprobe(inputPath, (err, metadata) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    
    const width = metadata.streams[0].width;
    const height = metadata.streams[0].height;
    const logoSize = Math.min(width, height) * 0.15;
    const x = width - logoSize - 10;
    const y = height - logoSize - 10;
    
    // Remover marca d'água
    ffmpeg(inputPath)
      .videoFilters([
        {
          filter: 'delogo',
          options: {
            x: Math.round(x),
            y: Math.round(y),
            w: Math.round(logoSize),
            h: Math.round(logoSize)
          }
        }
      ])
      .videoCodec('libx264')
      .audioCodec('copy')
      .outputOptions(['-preset fast', '-crf 20'])
      .on('end', () => {
        res.download(outputPath, (err) => {
          // Limpar arquivos
          fs.unlinkSync(inputPath);
          fs.unlinkSync(outputPath);
        });
      })
      .on('error', (err) => {
        res.status(500).json({ error: err.message });
        fs.unlinkSync(inputPath);
      })
      .save(outputPath);
  });
});

app.listen(5000, '0.0.0.0', () => {
  console.log('Serviço de remoção de marca d\'água rodando na porta 5000');
});
```

#### 2. Instalar Dependências

```bash
npm install express multer fluent-ffmpeg
```

#### 3. Executar

```bash
node watermark-service.js
```

---

## 🔧 Configurar no Bot (Railway)

### Variável de Ambiente

No Railway, adicione:

```
WATERMARK_REMOVAL_LOCAL_URL=http://IP_DA_VM:5000
```

Ou se usar serviço externo:

```
WATERMARK_REMOVAL_API=https://api.exemplo.com/remove-watermark
WATERMARK_REMOVAL_API_KEY=sua-chave-api
```

---

## 🎯 Recomendação

**Para começar rápido:** Use a **Opção 2 (Node.js)** - é mais simples e já usa FFmpeg.

**Para melhor qualidade:** Use a **Opção 1 (Python + OpenCV)** - tem mais técnicas de remoção disponíveis.

---

## 📝 Próximos Passos

1. Escolha uma opção
2. Configure na sua VM
3. Teste o endpoint
4. Configure a variável de ambiente no Railway
5. Teste o bot!

