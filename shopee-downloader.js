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

        // Aguardar o vídeo carregar (waitForTimeout foi removido, usar Promise com setTimeout)
        await new Promise(resolve => setTimeout(resolve, 3000));

        // Tentar encontrar o elemento de vídeo com melhor qualidade
        const videoUrl = await page.evaluate(() => {
          const videoUrls = [];
          
          // 1. Procurar por múltiplas sources no elemento <video>
          const videoElement = document.querySelector('video');
          if (videoElement) {
            // Verificar src direto
            if (videoElement.src) {
              videoUrls.push({ url: videoElement.src, quality: 'default' });
            }
            
            // Verificar todas as sources (podem ter diferentes qualidades)
            const sources = videoElement.querySelectorAll('source');
            sources.forEach(source => {
              if (source.src) {
                const quality = source.getAttribute('data-quality') || 
                              source.getAttribute('data-res') || 
                              source.getAttribute('label') || 
                              'unknown';
                videoUrls.push({ url: source.src, quality: quality });
              }
            });
          }

          // 2. Procurar em scripts ou dados JSON (pode ter múltiplas qualidades)
          const scripts = document.querySelectorAll('script');
          for (let script of scripts) {
            const content = script.textContent || script.innerHTML;
            
            // Procurar por objetos JSON com informações de vídeo
            try {
              // Tentar encontrar JSON com informações de vídeo
              const jsonMatch = content.match(/\{[^}]*"(?:video|url|src|source|playback|stream)[^}]*\}/gi);
              if (jsonMatch) {
                jsonMatch.forEach(jsonStr => {
                  try {
                    const data = JSON.parse(jsonStr);
                    // Procurar por URLs de vídeo no JSON
                    const findVideoUrls = (obj) => {
                      for (let key in obj) {
                        if (typeof obj[key] === 'string' && /https?:\/\/[^\s"']+\.(mp4|webm|m3u8)/i.test(obj[key])) {
                          const quality = key.toLowerCase().includes('hd') || key.toLowerCase().includes('1080') ? '1080p' :
                                         key.toLowerCase().includes('720') ? '720p' :
                                         key.toLowerCase().includes('480') ? '480p' :
                                         key.toLowerCase().includes('360') ? '360p' : 'default';
                          videoUrls.push({ url: obj[key], quality: quality });
                        } else if (typeof obj[key] === 'object') {
                          findVideoUrls(obj[key]);
                        }
                      }
                    };
                    findVideoUrls(data);
                  } catch (e) {
                    // Continuar procurando
                  }
                });
              }
              
              // Procurar por URLs de vídeo diretamente
              const videoUrlMatches = content.match(/https?:\/\/[^\s"']+\.(mp4|webm|m3u8)/gi);
              if (videoUrlMatches) {
                videoUrlMatches.forEach(url => {
                  // Tentar determinar qualidade pela URL
                  let quality = 'default';
                  if (url.includes('1080') || url.includes('hd') || url.toLowerCase().includes('high')) {
                    quality = '1080p';
                  } else if (url.includes('720')) {
                    quality = '720p';
                  } else if (url.includes('480')) {
                    quality = '480p';
                  } else if (url.includes('360')) {
                    quality = '360p';
                  }
                  videoUrls.push({ url: url, quality: quality });
                });
              }
            } catch (e) {
              // Continuar procurando
            }
          }

          // 3. Priorizar maior qualidade
          if (videoUrls.length === 0) {
            return null;
          }

          // Ordenar por qualidade (1080p > 720p > 480p > 360p > default)
          const qualityOrder = { '1080p': 5, '720p': 4, '480p': 3, '360p': 2, 'default': 1, 'unknown': 0 };
          videoUrls.sort((a, b) => {
            const aQuality = qualityOrder[a.quality.toLowerCase()] || 0;
            const bQuality = qualityOrder[b.quality.toLowerCase()] || 0;
            return bQuality - aQuality;
          });

          console.log('Vídeos encontrados:', videoUrls.map(v => `${v.quality}: ${v.url.substring(0, 50)}...`));
          
          // Retornar a melhor qualidade
          return videoUrls[0].url;
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

