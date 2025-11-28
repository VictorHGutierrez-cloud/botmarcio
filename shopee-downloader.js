const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ShopeeDownloader {
  constructor() {
    this.videosDir = path.join(__dirname, 'downloads');
    // Criar diretório de downloads se não existir
    if (!fs.existsSync(this.videosDir)) {
      fs.mkdirSync(this.videosDir, { recursive: true });
    }
  }

  /**
   * Extrai o link real do vídeo da Shopee a partir de um link compartilhado
   */
  async extractVideoUrl(shareUrl) {
    try {
      // Decodificar URL se necessário
      let decodedUrl = decodeURIComponent(shareUrl);
      
      // Extrair o parâmetro 'redir' se existir
      const urlObj = new URL(decodedUrl);
      if (urlObj.searchParams.has('redir')) {
        decodedUrl = urlObj.searchParams.get('redir');
      }

      console.log('URL decodificada:', decodedUrl);

      // Usar Puppeteer para carregar a página e extrair o vídeo
      // Configuração otimizada para Railway
      const launchOptions = {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu'
        ]
      };

      // Verificar se há um caminho especificado via variável de ambiente
      if (process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
        console.log(`Usando Chromium da variável de ambiente: ${launchOptions.executablePath}`);
      } else if (process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD === 'true') {
        // Se PUPPETEER_SKIP_CHROMIUM_DOWNLOAD está definido, tentar encontrar Chromium no sistema
        // Mas no Ubuntu 24.04, o chromium-browser é apenas um wrapper para snap
        // Então vamos tentar encontrar um Chromium real ou usar o do Puppeteer
        const possiblePaths = [
          '/usr/bin/chromium',
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome'
        ];
        
        let chromiumPath = null;
        for (const path of possiblePaths) {
          try {
            if (fs.existsSync(path)) {
              // Verificar se não é um script wrapper (verificar se é binário ELF)
              const stats = fs.statSync(path);
              if (stats.isFile()) {
                // Ler primeiros bytes para verificar se é ELF (binário real)
                const buffer = fs.readFileSync(path, { start: 0, end: 4 });
                if (buffer[0] === 0x7f && buffer[1] === 0x45 && buffer[2] === 0x4c && buffer[3] === 0x46) {
                  chromiumPath = path;
                  console.log(`Chromium encontrado em: ${path}`);
                  break;
                }
              }
            }
          } catch (e) {
            // Continuar procurando
          }
        }
        
        if (chromiumPath) {
          launchOptions.executablePath = chromiumPath;
        } else {
          console.warn('Chromium não encontrado no sistema e PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true');
          console.warn('Usando Chromium do Puppeteer (será baixado automaticamente)...');
          // Remover a restrição para permitir que Puppeteer baixe o Chromium
          delete process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;
        }
      } else {
        // Se PUPPETEER_SKIP_CHROMIUM_DOWNLOAD não estiver definido, usar o Chromium do Puppeteer
        console.log('Usando Chromium do Puppeteer (será baixado automaticamente se necessário)...');
      }

      const browser = await puppeteer.launch(launchOptions);

      const page = await browser.newPage();
      
      // Definir user agent para evitar bloqueios
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      
      try {
        await page.goto(decodedUrl, { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });

        // Aguardar o vídeo carregar
        await page.waitForTimeout(3000);

        // Tentar encontrar o elemento de vídeo
        const videoUrl = await page.evaluate(() => {
          // Procurar por tag <video>
          const videoElement = document.querySelector('video');
          if (videoElement && videoElement.src) {
            return videoElement.src;
          }

          // Procurar por source dentro de video
          const sourceElement = document.querySelector('video source');
          if (sourceElement && sourceElement.src) {
            return sourceElement.src;
          }

          // Procurar em scripts ou dados JSON
          const scripts = document.querySelectorAll('script');
          for (let script of scripts) {
            const content = script.textContent || script.innerHTML;
            // Procurar por URLs de vídeo comuns
            const videoUrlMatch = content.match(/https?:\/\/[^\s"']+\.(mp4|webm|m3u8)/i);
            if (videoUrlMatch) {
              return videoUrlMatch[0];
            }
          }

          return null;
        });

        await browser.close();

        if (videoUrl) {
          console.log('URL do vídeo encontrada:', videoUrl);
          return videoUrl;
        }

        // Se não encontrou, tentar método alternativo com axios
        const response = await axios.get(decodedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        const $ = cheerio.load(response.data);
        
        // Procurar por vídeo no HTML
        const videoSrc = $('video').attr('src') || $('video source').attr('src');
        if (videoSrc) {
          return videoSrc.startsWith('http') ? videoSrc : new URL(videoSrc, decodedUrl).href;
        }

        // Procurar em scripts
        $('script').each((i, elem) => {
          const scriptContent = $(elem).html();
          const match = scriptContent?.match(/https?:\/\/[^\s"']+\.(mp4|webm|m3u8)/i);
          if (match) {
            return match[0];
          }
        });

        throw new Error('Não foi possível encontrar a URL do vídeo');

      } catch (error) {
        await browser.close();
        throw error;
      }

    } catch (error) {
      console.error('Erro ao extrair URL do vídeo:', error);
      throw new Error(`Erro ao processar link da Shopee: ${error.message}`);
    }
  }

  /**
   * Baixa o vídeo da URL fornecida
   */
  async downloadVideo(videoUrl, filename) {
    try {
      const filePath = path.join(this.videosDir, filename);

      console.log('Baixando vídeo de:', videoUrl);
      console.log('Salvando em:', filePath);

      const response = await axios({
        method: 'GET',
        url: videoUrl,
        responseType: 'stream',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://shopee.com.br/'
        },
        timeout: 300000 // 5 minutos
      });

      const writer = fs.createWriteStream(filePath);
      response.data.pipe(writer);

      return new Promise((resolve, reject) => {
        writer.on('finish', () => {
          console.log('Vídeo baixado com sucesso:', filePath);
          resolve(filePath);
        });
        writer.on('error', (err) => {
          console.error('Erro ao salvar vídeo:', err);
          reject(err);
        });
      });

    } catch (error) {
      console.error('Erro ao baixar vídeo:', error);
      throw new Error(`Erro ao baixar vídeo: ${error.message}`);
    }
  }

  /**
   * Processa o link da Shopee e baixa o vídeo
   */
  async processShopeeLink(shareUrl, userId) {
    try {
      // Extrair URL do vídeo
      const videoUrl = await this.extractVideoUrl(shareUrl);
      
      // Gerar nome do arquivo
      const timestamp = Date.now();
      const filename = `shopee_video_${userId}_${timestamp}.mp4`;
      
      // Baixar vídeo
      const filePath = await this.downloadVideo(videoUrl, filename);
      
      return {
        success: true,
        filePath: filePath,
        filename: filename
      };

    } catch (error) {
      console.error('Erro ao processar link da Shopee:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Limpa arquivos antigos (opcional, para economizar espaço)
   */
  cleanupOldFiles(maxAgeHours = 24) {
    const files = fs.readdirSync(this.videosDir);
    const now = Date.now();
    const maxAge = maxAgeHours * 60 * 60 * 1000;

    files.forEach(file => {
      const filePath = path.join(this.videosDir, file);
      const stats = fs.statSync(filePath);
      const age = now - stats.mtimeMs;

      if (age > maxAge) {
        fs.unlinkSync(filePath);
        console.log(`Arquivo antigo removido: ${file}`);
      }
    });
  }
}

module.exports = ShopeeDownloader;

