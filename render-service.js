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
  res.json({ status: 'ok', service: 'render-service', version: '1.0.0' });
});

// Função auxiliar para obter informações do vídeo
function getVideoInfo(videoPath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) return reject(err);
      
      const videoStream = metadata.streams.find(s => s.codec_type === 'video');
      if (!videoStream) {
        return reject(new Error('Nenhum stream de vídeo encontrado'));
      }
      
      resolve({
        width: videoStream.width,
        height: videoStream.height,
        duration: metadata.format.duration || 0,
        size: metadata.format.size || 0
      });
    });
  });
}

// Endpoint principal: renderizar vídeo em 720p e remover marca d'água
app.post('/render', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum vídeo enviado' });
  }

  const inputPath = req.file.path;
  const outputPath = path.join('outputs', `${Date.now()}_rendered.mp4`);

  console.log(`📥 Processando vídeo: ${req.file.originalname || 'sem-nome'}`);
  console.log(`📐 Tamanho original: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

  try {
    // Obter informações do vídeo
    const videoInfo = await getVideoInfo(inputPath);
    const { width, height, duration } = videoInfo;
    
    console.log(`📊 Resolução original: ${width}x${height}`);
    console.log(`⏱️ Duração: ${duration.toFixed(2)}s`);

    // Calcular nova resolução mantendo aspect ratio (máximo 720p)
    const maxWidth = 1280;
    const maxHeight = 720;
    let newWidth = width;
    let newHeight = height;

    if (width > maxWidth || height > maxHeight) {
      const aspectRatio = width / height;
      if (width > height) {
        // Vídeo horizontal
        newWidth = maxWidth;
        newHeight = Math.round(maxWidth / aspectRatio);
        if (newHeight > maxHeight) {
          newHeight = maxHeight;
          newWidth = Math.round(maxHeight * aspectRatio);
        }
      } else {
        // Vídeo vertical
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
    const x = Math.max(0, newWidth - logoSize - 10);
    const y = Math.max(0, newHeight - logoSize - 10);

    // Processar vídeo: redimensionar + remover marca d'água
    await new Promise((resolve, reject) => {
      const filters = [];
      
      // Adicionar scale se necessário
      if (newWidth !== width || newHeight !== height) {
        filters.push({
          filter: 'scale',
          options: {
            w: newWidth,
            h: newHeight
          }
        });
      }
      
      // Adicionar delogo para remover marca d'água
      filters.push({
        filter: 'delogo',
        options: {
          x: Math.round(x),
          y: Math.round(y),
          w: Math.round(logoSize),
          h: Math.round(logoSize),
          show: 0
        }
      });

      ffmpeg(inputPath)
        .videoFilters(filters)
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
          console.error('❌ Erro no FFmpeg:', err.message);
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
      if (err) {
        console.error('❌ Erro ao enviar arquivo:', err);
      }
      
      // Limpar arquivos temporários após 5 segundos
      setTimeout(() => {
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (cleanupErr) {
          console.warn('⚠️ Erro ao limpar arquivos temporários:', cleanupErr.message);
        }
      }, 5000);
    });

  } catch (error) {
    console.error('❌ Erro ao processar vídeo:', error);
    res.status(500).json({ error: error.message });
    
    // Limpar arquivos em caso de erro
    setTimeout(() => {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (cleanupErr) {
        // Ignorar erros de limpeza
      }
    }, 1000);
  }
});

// Endpoint alternativo: apenas remover marca d'água (sem renderizar)
app.post('/remove-watermark', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Nenhum vídeo enviado' });
  }

  const inputPath = req.file.path;
  const outputPath = path.join('outputs', `${Date.now()}_no_watermark.mp4`);

  try {
    const videoInfo = await getVideoInfo(inputPath);
    const { width, height } = videoInfo;
    
    const logoSize = Math.min(width, height) * 0.15;
    const x = Math.max(0, width - logoSize - 10);
    const y = Math.max(0, height - logoSize - 10);

    await new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .videoFilters([
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
        .audioCodec('copy')
        .outputOptions(['-preset medium', '-crf 20', '-movflags +faststart'])
        .on('end', resolve)
        .on('error', reject)
        .save(outputPath);
    });

    res.download(outputPath, 'video_no_watermark.mp4', (err) => {
      setTimeout(() => {
        try {
          if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
          if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        } catch (e) {}
      }, 5000);
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
    setTimeout(() => {
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (e) {}
    }, 1000);
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🎬 Serviço de renderização rodando na porta ${PORT}`);
  console.log(`📡 Endpoints disponíveis:`);
  console.log(`   - GET  /health`);
  console.log(`   - POST /render (720p + remover marca d'água)`);
  console.log(`   - POST /remove-watermark (apenas remover marca d'água)`);
});

