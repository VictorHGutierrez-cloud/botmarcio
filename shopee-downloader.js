const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
const { execSync } = require('child_process');

// Usar plugin stealth para evitar detecção de bot
puppeteer.use(StealthPlugin());

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
      
      // Monitorar requisições de rede para encontrar URLs de vídeo HD e JSON da API (ANTES de navegar)
      const networkRequests = [];
      const apiResponses = []; // Armazenar respostas JSON da API
      
      page.on('response', async (response) => {
        const url = response.url();
        
        // Capturar URLs de vídeo
        if (url.match(/\.(mp4|webm|m3u8)/i)) {
          networkRequests.push(url);
          console.log('URL de vídeo encontrada na rede:', url);
        }
        
        // Interceptar requisições JSON da API da Shopee (múltiplos endpoints possíveis)
        // Expandido para capturar mais endpoints que podem ter vídeo sem marca d'água
        const apiPatterns = [
          'get_item_detail',
          'api/v4/item',
          'api/v2/item',
          'api/v1/item',
          'api/v3/item',
          'api/v5/item',
          'item/get',
          'item/detail',
          'product/detail',
          'video',
          'media',
          'cdn.shopee',
          'shopee.com.br/api',
          'shopee.com/api',
          'mall/shopee',
          'xshopee',
          'seller',
          'item_extra',
          'video_info',
          'video_url',
          'original_video',
          'raw_video',
          'share-video',
          'share_video',
          'sv.shopee',
          'cf.shopee',
          'item/get_extra',
          'item/get_detail',
          'product/get',
          'product/get_detail'
        ];
        
        const isApiRequest = apiPatterns.some(pattern => url.includes(pattern));
        
        if (isApiRequest) {
          try {
            const contentType = response.headers()['content-type'] || '';
            const status = response.status();
            
            // Capturar headers importantes para debug
            const headers = response.headers();
            
            if (contentType.includes('application/json') || contentType.includes('text/json') || status === 200) {
              try {
                const jsonData = await response.json();
                apiResponses.push({ 
                  url: url, 
                  data: jsonData,
                  headers: headers,
                  status: status
                });
                console.log(`✅ API capturada [${status}]: ${url.substring(0, 100)}`);
                
                // Log especial se encontrar campos relacionados a vídeo
                const jsonStr = JSON.stringify(jsonData);
                if (jsonStr.toLowerCase().includes('video') || jsonStr.toLowerCase().includes('mp4') || 
                    jsonStr.toLowerCase().includes('media') || jsonStr.toLowerCase().includes('url')) {
                  console.log(`   🎥 Possível URL de vídeo nesta resposta!`);
                }
              } catch (e) {
                // Tentar ler como texto e fazer parse manual
                try {
                  const text = await response.text();
                  const jsonData = JSON.parse(text);
                  apiResponses.push({ 
                    url: url, 
                    data: jsonData,
                    headers: headers,
                    status: status
                  });
                  console.log(`✅ API capturada (texto) [${status}]: ${url.substring(0, 100)}`);
                } catch (e2) {
                  // Ignorar erros ao ler JSON
                }
              }
            }
          } catch (e) {
            // Ignorar erros
          }
        }
        
        // TAMBÉM interceptar requisições de vídeo diretamente (podem ter parâmetros especiais)
        if (url.match(/\.(mp4|webm|m3u8)/i)) {
          // Log detalhado da URL de vídeo encontrada
          const urlObj = new URL(url);
          const params = Array.from(urlObj.searchParams.entries());
          console.log(`📹 URL de vídeo na rede: ${url.substring(0, 100)}`);
          if (params.length > 0) {
            console.log(`   Parâmetros: ${params.map(([k, v]) => `${k}=${v.substring(0, 30)}`).join(', ')}`);
          }
        }
      });
      
      // Definir user agent de iPhone para receber vídeos de melhor qualidade
      // Sites costumam servir MP4 direto de alta qualidade para iOS
      const userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
      await page.setUserAgent(userAgent);
      
      // Adicionar viewport de iPhone para parecer mais real
      await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3 });
      
      // Adicionar headers extras que podem ajudar a obter vídeos de melhor qualidade
      await page.setExtraHTTPHeaders({
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Cache-Control': 'max-age=0'
      });
      
      // Adicionar cookies de sessão se disponíveis (opcional - via variável de ambiente)
      // Formato: COOKIE_NAME1=value1; COOKIE_NAME2=value2
      if (process.env.SHOPEE_COOKIES) {
        try {
          const cookies = process.env.SHOPEE_COOKIES.split(';').map(cookie => {
            const [name, value] = cookie.trim().split('=');
            return {
              name: name.trim(),
              value: value.trim(),
              domain: '.shopee.com.br',
              path: '/'
            };
          });
          await page.setCookie(...cookies);
          console.log('✅ Cookies de sessão adicionados');
        } catch (e) {
          console.warn('⚠️ Erro ao adicionar cookies:', e.message);
        }
      }
      
      // Tentar adicionar cookies comuns da Shopee se não foram fornecidos
      // Isso pode ajudar a parecer mais com um usuário real
      try {
        await page.setCookie({
          name: 'SPC_EC',
          value: '',
          domain: '.shopee.com.br',
          path: '/',
          httpOnly: false,
          secure: true,
          sameSite: 'Lax'
        });
      } catch (e) {
        // Ignorar se falhar
      }
      
      try {
        await page.goto(decodedUrl, { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });

        // Aguardar o vídeo carregar completamente e aguardar requisições da API
        await new Promise(resolve => setTimeout(resolve, 5000));

        // PRIMEIRO: Tentar extrair URL de vídeo das respostas JSON da API (melhor qualidade)
        let apiVideoUrl = null;
        let bestQualityUrl = null;
        const allVideoUrls = []; // Coletar todas as URLs encontradas para comparar qualidade
        
        for (const apiResponse of apiResponses) {
          try {
            const findVideoInObject = (obj, path = '') => {
              if (!obj || typeof obj !== 'object') return [];
              
              const foundUrls = [];
              
              for (let key in obj) {
                const currentPath = path ? `${path}.${key}` : key;
                const value = obj[key];
                
                // Procurar por campos que podem conter URLs de vídeo
                if (typeof value === 'string') {
                  // Verificar se é uma URL de vídeo
                  if (/https?:\/\/[^\s"']+\.(mp4|webm|m3u8)/i.test(value)) {
                    // Determinar qualidade pela URL - procurar por múltiplos padrões
                    let quality = 'default';
                    const urlLower = value.toLowerCase();
                    
                    // IMPORTANTE: Procurar por indicadores de vídeo SEM marca d'água
                    // Padrões que podem indicar vídeo original/sem marca d'água:
                    const isOriginal = urlLower.includes('original') || urlLower.includes('raw') || 
                                      urlLower.includes('source') || urlLower.includes('master') ||
                                      urlLower.includes('no_watermark') || urlLower.includes('nowm') ||
                                      urlLower.includes('clean') || urlLower.includes('pure');
                    
                    // Padrões para 1080p
                    if (value.includes('1080') || urlLower.includes('hd') || urlLower.includes('high') || 
                        isOriginal || urlLower.includes('max') || urlLower.includes('best') ||
                        urlLower.includes('quality_high') || urlLower.includes('q_high')) {
                      quality = '1080p';
                    } 
                    // Padrões para 720p - mais abrangente
                    else if (value.includes('720') || urlLower.includes('720p') || urlLower.includes('hd720') ||
                             urlLower.includes('quality_medium') || urlLower.includes('q_medium') ||
                             urlLower.includes('medium') || urlLower.includes('standard')) {
                      quality = '720p';
                    } 
                    // Padrões para 480p
                    else if (value.includes('480') || urlLower.includes('480p') || urlLower.includes('sd')) {
                      quality = '480p';
                    } 
                    // Padrões para 360p
                    else if (value.includes('360') || urlLower.includes('360p') || urlLower.includes('low')) {
                      quality = '360p';
                    }
                    // Se não encontrou padrão, mas está em campo de vídeo, assumir melhor qualidade
                    else if (key.toLowerCase().includes('video') || key.toLowerCase().includes('url') || 
                             key.toLowerCase().includes('source') || key.toLowerCase().includes('playback') ||
                             key.toLowerCase().includes('original') || key.toLowerCase().includes('raw') ||
                             key.toLowerCase().includes('master') || isOriginal) {
                      quality = 'unknown'; // Será verificado depois, mas pode ser de alta qualidade
                    }
                    
                    // Priorizar URLs que parecem ser originais/sem marca d'água
                    const priority = isOriginal ? 1 : 0;
                    
                    foundUrls.push({ 
                      url: value, 
                      quality: quality, 
                      path: currentPath,
                      isOriginal: isOriginal,
                      priority: priority
                    });
                    
                    const originalMark = isOriginal ? ' [ORIGINAL/SEM MARCA D\'ÁGUA?]' : '';
                    console.log(`📹 URL de vídeo encontrada na API (${currentPath}, ${quality})${originalMark}:`, value.substring(0, 80));
                  }
                  // Também procurar por campos que podem conter URLs de vídeo em objetos aninhados
                  // Ex: video_info.url, video.url, media.video_url, etc.
                  if (key.toLowerCase().includes('video') || key.toLowerCase().includes('media')) {
                    // Tentar extrair URL mesmo que não termine com extensão
                    const urlMatch = value.match(/https?:\/\/[^\s"']+/i);
                    if (urlMatch && !value.match(/\.(jpg|jpeg|png|gif|webp|svg)/i)) {
                      foundUrls.push({ url: urlMatch[0], quality: 'unknown', path: currentPath });
                    }
                  }
                } else if (typeof value === 'object' && value !== null) {
                  const nestedUrls = findVideoInObject(value, currentPath);
                  foundUrls.push(...nestedUrls);
                }
              }
              return foundUrls;
            };
            
            const foundUrls = findVideoInObject(apiResponse.data);
            allVideoUrls.push(...foundUrls);
          } catch (e) {
            console.warn('⚠️ Erro ao processar resposta da API:', e.message);
          }
        }
        
        // NÃO retornar imediatamente - vamos coletar TODAS as URLs primeiro
        // e depois escolher a melhor de todas as fontes (API + DOM + Network)

        // SEGUNDO: Tentar encontrar o elemento de vídeo com melhor qualidade (fallback)
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

        // Adicionar URLs do DOM à lista (se encontrou)
        if (videoUrl) {
          // Determinar qualidade da URL do DOM
          let domQuality = 'unknown';
          const urlLower = videoUrl.toLowerCase();
          if (videoUrl.includes('1080') || urlLower.includes('hd') || urlLower.includes('high') || 
              urlLower.includes('original') || urlLower.includes('max') || urlLower.includes('best')) {
            domQuality = '1080p';
          } else if (videoUrl.includes('720') || urlLower.includes('720p') || urlLower.includes('hd720') ||
                     urlLower.includes('medium') || urlLower.includes('standard')) {
            domQuality = '720p';
          } else if (videoUrl.includes('480') || urlLower.includes('480p') || urlLower.includes('sd')) {
            domQuality = '480p';
          } else if (videoUrl.includes('360') || urlLower.includes('360p') || urlLower.includes('low')) {
            domQuality = '360p';
          }
          allVideoUrls.push({ url: videoUrl, quality: domQuality, path: 'DOM' });
          console.log(`📹 URL encontrada no DOM (${domQuality}):`, videoUrl.substring(0, 80));
        }

        // Adicionar URLs das requisições de rede à lista
        if (networkRequests.length > 0) {
          console.log(`📡 URLs encontradas nas requisições de rede: ${networkRequests.length}`);
          networkRequests.forEach(url => {
            const urlLower = url.toLowerCase();
            let quality = 'unknown';
            if (url.includes('1080') || urlLower.includes('hd') || urlLower.includes('high') || 
                urlLower.includes('original') || urlLower.includes('max') || urlLower.includes('best')) {
              quality = '1080p';
            } else if (url.includes('720') || urlLower.includes('720p') || urlLower.includes('hd720') ||
                       urlLower.includes('medium') || urlLower.includes('standard')) {
              quality = '720p';
            } else if (url.includes('480') || urlLower.includes('480p') || urlLower.includes('sd')) {
              quality = '480p';
            } else if (url.includes('360') || urlLower.includes('360p') || urlLower.includes('low')) {
              quality = '360p';
            }
            allVideoUrls.push({ url: url, quality: quality, path: 'Network' });
          });
        }

        // AGORA sim: ordenar TODAS as URLs de TODAS as fontes e escolher a melhor
        let finalVideoUrl = null;
        if (allVideoUrls.length > 0) {
          // IMPORTANTE: URLs "unknown" podem ser de alta qualidade, só não têm padrão no nome
          // PRIORIZAR URLs que parecem ser originais/sem marca d'água
          const qualityOrder = { '1080p': 6, '720p': 5, '480p': 4, '360p': 3, 'unknown': 2, 'default': 1 };
          allVideoUrls.sort((a, b) => {
            // Primeiro: priorizar URLs que parecem ser originais/sem marca d'água
            if (a.isOriginal && !b.isOriginal) return -1;
            if (!a.isOriginal && b.isOriginal) return 1;
            
            // Segundo: priorizar por qualidade conhecida
            const aQuality = qualityOrder[a.quality.toLowerCase()] || 0;
            const bQuality = qualityOrder[b.quality.toLowerCase()] || 0;
            if (aQuality !== bQuality) return bQuality - aQuality;
            
            // Terceiro: se mesma qualidade, manter ordem original (primeira encontrada pode ser melhor)
            return 0;
          });
          
          // Remover duplicatas (mesma URL)
          const uniqueUrls = [];
          const seenUrls = new Set();
          for (const videoUrl of allVideoUrls) {
            if (!seenUrls.has(videoUrl.url)) {
              seenUrls.add(videoUrl.url);
              uniqueUrls.push(videoUrl);
            }
          }
          
          // Usar a primeira URL da lista ordenada (melhor qualidade)
          finalVideoUrl = uniqueUrls[0].url;
          
          console.log(`\n📊 RESUMO DE TODAS AS URLs ENCONTRADAS (${uniqueUrls.length} únicas):`);
          uniqueUrls.forEach((u, i) => {
            const marker = i === 0 ? '✅ ESCOLHIDA' : '  ';
            console.log(`${marker} ${i + 1}. ${u.quality.padEnd(8)} [${u.path.padEnd(8)}] ${u.url.substring(0, 70)}...`);
          });
          
          console.log(`\n✅ Melhor URL escolhida: ${uniqueUrls[0].quality} - ${finalVideoUrl.substring(0, 80)}`);
        }

        await browser.close();

        if (finalVideoUrl) {
          console.log('✅ URL do vídeo encontrada (melhor qualidade de todas as fontes):', finalVideoUrl);
          return finalVideoUrl;
        }

        // Se não encontrou, tentar fazer requisições diretas para diferentes endpoints da API
        // Extrair itemid e shopid da URL se possível
        let itemId = null;
        let shopId = null;
        try {
          const urlMatch = decodedUrl.match(/item[_-]?id[=:](\d+)/i) || decodedUrl.match(/i\.(\d+)/);
          if (urlMatch) itemId = urlMatch[1];
          
          const shopMatch = decodedUrl.match(/shop[_-]?id[=:](\d+)/i) || decodedUrl.match(/s\.(\d+)/);
          if (shopMatch) shopId = shopMatch[1];
          
          // Tentar extrair de parâmetros de query
          const urlObj = new URL(decodedUrl);
          itemId = itemId || urlObj.searchParams.get('itemid') || urlObj.searchParams.get('item_id');
          shopId = shopId || urlObj.searchParams.get('shopid') || urlObj.searchParams.get('shop_id');
        } catch (e) {
          // Ignorar erros
        }
        
        // Se encontrou itemid, tentar diferentes endpoints da API
        if (itemId && shopId) {
          console.log(`🔍 Tentando endpoints diretos da API (itemid: ${itemId}, shopid: ${shopId})...`);
          
          const apiEndpoints = [
            `https://shopee.com.br/api/v4/item/get_item_detail?itemid=${itemId}&shopid=${shopId}`,
            `https://shopee.com.br/api/v2/item/get?itemid=${itemId}&shopid=${shopId}`,
            `https://shopee.com.br/api/v1/item/get?itemid=${itemId}&shopid=${shopId}`,
            `https://shopee.com.br/api/v4/item/get?itemid=${itemId}&shopid=${shopId}`,
            `https://shopee.com.br/api/v4/item/get_item_extra?itemid=${itemId}&shopid=${shopId}`
          ];
          
          const headers = {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Referer': 'https://shopee.com.br/',
            'Origin': 'https://shopee.com.br',
            'X-Requested-With': 'XMLHttpRequest'
          };
          
          // Adicionar cookies se disponíveis
          if (process.env.SHOPEE_COOKIES) {
            headers['Cookie'] = process.env.SHOPEE_COOKIES;
          }
          
          for (const endpoint of apiEndpoints) {
            try {
              console.log(`   Tentando: ${endpoint.substring(0, 80)}...`);
              const apiResponse = await axios.get(endpoint, {
                headers: headers,
                timeout: 10000,
                validateStatus: (status) => status < 500 // Aceitar 4xx mas não 5xx
              });
              
              if (apiResponse.status === 200 && apiResponse.data) {
                // Procurar URLs de vídeo na resposta
                const jsonStr = JSON.stringify(apiResponse.data);
                const videoUrlMatches = jsonStr.match(/https?:\/\/[^\s"']+\.(mp4|webm|m3u8)/gi);
                if (videoUrlMatches && videoUrlMatches.length > 0) {
                  console.log(`   ✅ Encontrou ${videoUrlMatches.length} URLs de vídeo neste endpoint!`);
                  // Processar essas URLs
                  const findVideoInObject = (obj) => {
                    const foundUrls = [];
                    const search = (val, path = '') => {
                      if (typeof val === 'string' && /https?:\/\/[^\s"']+\.(mp4|webm|m3u8)/i.test(val)) {
                        const urlLower = val.toLowerCase();
                        let quality = 'unknown';
                        let isOriginal = urlLower.includes('original') || urlLower.includes('raw') || 
                                        urlLower.includes('source') || urlLower.includes('master') ||
                                        urlLower.includes('no_watermark') || urlLower.includes('nowm');
                        
                        if (val.includes('1080') || urlLower.includes('hd') || urlLower.includes('high') || isOriginal) {
                          quality = '1080p';
                        } else if (val.includes('720') || urlLower.includes('720p') || urlLower.includes('hd720')) {
                          quality = '720p';
                        } else if (val.includes('480') || urlLower.includes('480p')) {
                          quality = '480p';
                        } else if (val.includes('360') || urlLower.includes('360p')) {
                          quality = '360p';
                        }
                        
                        foundUrls.push({ url: val, quality: quality, path: path, isOriginal: isOriginal });
                      } else if (typeof val === 'object' && val !== null) {
                        for (let key in val) {
                          search(val[key], path ? `${path}.${key}` : key);
                        }
                      }
                    };
                    search(obj);
                    return foundUrls;
                  };
                  
                  const foundUrls = findVideoInObject(apiResponse.data);
                  if (foundUrls.length > 0) {
                    allVideoUrls.push(...foundUrls);
                    console.log(`   ✅ Adicionadas ${foundUrls.length} URLs da API direta`);
                  }
                }
              }
            } catch (e) {
              // Continuar tentando outros endpoints
              if (e.response && e.response.status === 404) {
                console.log(`   ⚠️ Endpoint não encontrado (404)`);
              }
            }
          }
          
          // Se encontrou URLs na API direta, reordenar e escolher a melhor
          if (allVideoUrls.length > 0) {
            const qualityOrder = { '1080p': 6, '720p': 5, '480p': 4, '360p': 3, 'unknown': 2, 'default': 1 };
            allVideoUrls.sort((a, b) => {
              if (a.isOriginal && !b.isOriginal) return -1;
              if (!a.isOriginal && b.isOriginal) return 1;
              const aQuality = qualityOrder[a.quality.toLowerCase()] || 0;
              const bQuality = qualityOrder[b.quality.toLowerCase()] || 0;
              return bQuality - aQuality;
            });
            
            const uniqueUrls = [];
            const seenUrls = new Set();
            for (const videoUrl of allVideoUrls) {
              if (!seenUrls.has(videoUrl.url)) {
                seenUrls.add(videoUrl.url);
                uniqueUrls.push(videoUrl);
              }
            }
            
            if (uniqueUrls.length > 0) {
              finalVideoUrl = uniqueUrls[0].url;
              console.log(`\n✅ URL encontrada via API direta: ${uniqueUrls[0].quality} - ${finalVideoUrl.substring(0, 80)}`);
              return finalVideoUrl;
            }
          }
        }
        
        // Se não encontrou, tentar método alternativo com axios (usando User-Agent de iPhone)
        const response = await axios.get(decodedUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Referer': 'https://shopee.com.br/'
          }
        });

        const $ = cheerio.load(response.data);
        
        const videoUrls = [];
        
        // Procurar por múltiplas sources no HTML
        $('video source').each((i, elem) => {
          const src = $(elem).attr('src');
          if (src) {
            const quality = $(elem).attr('data-quality') || 
                          $(elem).attr('data-res') || 
                          $(elem).attr('label') || 
                          'default';
            const fullUrl = src.startsWith('http') ? src : new URL(src, decodedUrl).href;
            videoUrls.push({ url: fullUrl, quality: quality });
          }
        });
        
        // Se não encontrou sources, tentar src direto do video
        const videoSrc = $('video').attr('src');
        if (videoSrc && videoUrls.length === 0) {
          const fullUrl = videoSrc.startsWith('http') ? videoSrc : new URL(videoSrc, decodedUrl).href;
          videoUrls.push({ url: fullUrl, quality: 'default' });
        }

        // Procurar em scripts (pode ter múltiplas qualidades)
        $('script').each((i, elem) => {
          const scriptContent = $(elem).html();
          if (scriptContent) {
            const matches = scriptContent.match(/https?:\/\/[^\s"']+\.(mp4|webm|m3u8)/gi);
            if (matches) {
              matches.forEach(url => {
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
          }
        });
        
        if (videoUrls.length > 0) {
          // Ordenar por qualidade e retornar a melhor
          const qualityOrder = { '1080p': 5, '720p': 4, '480p': 3, '360p': 2, 'default': 1, 'unknown': 0 };
          videoUrls.sort((a, b) => {
            const aQuality = qualityOrder[a.quality.toLowerCase()] || 0;
            const bQuality = qualityOrder[b.quality.toLowerCase()] || 0;
            return bQuality - aQuality;
          });
          console.log('Vídeos encontrados (método alternativo):', videoUrls.map(v => `${v.quality}: ${v.url.substring(0, 50)}...`));
          return videoUrls[0].url;
        }

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
   * Verifica a resolução real de um vídeo sem baixar completamente
   * Retorna a altura do vídeo (para determinar se é 720p, 1080p, etc)
   */
  async checkVideoResolution(videoUrl) {
    try {
      // Fazer uma requisição HEAD para obter headers
      const headResponse = await axios.head(videoUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
          'Referer': 'https://shopee.com.br/'
        },
        timeout: 10000
      });
      
      // Se o Content-Length estiver disponível, podemos estimar qualidade
      // Mas o melhor é baixar uma pequena parte e verificar
      return null; // Por enquanto retorna null, pode ser melhorado depois
    } catch (e) {
      return null;
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
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
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
   * Obtém informações do vídeo (resolução, etc)
   */
  async getVideoInfo(videoPath) {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(videoPath, (err, metadata) => {
        if (err) {
          reject(err);
          return;
        }
        const videoStream = metadata.streams.find(s => s.codec_type === 'video');
        if (videoStream) {
          resolve({
            width: videoStream.width,
            height: videoStream.height,
            duration: metadata.format.duration
          });
        } else {
          reject(new Error('Stream de vídeo não encontrado'));
        }
      });
    });
  }

  /**
   * Otimiza o vídeo usando ffmpeg SEM alterar a resolução (sem upscaling)
   * Apenas melhora codec, compatibilidade e qualidade de encoding
   */
  /**
   * Remove marca d'água do vídeo usando FFmpeg
   * Tenta várias técnicas: crop, delogo, overlay
   */
  async removeWatermark(inputPath, outputPath) {
    return new Promise(async (resolve, reject) => {
      console.log('🎨 Tentando remover marca d'água do vídeo...');
      
      try {
        // Primeiro, obter informações do vídeo para saber onde pode estar a marca d'água
        const videoInfo = await this.getVideoInfo(inputPath);
        const width = videoInfo.width;
        const height = videoInfo.height;
        
        console.log(`📐 Dimensões do vídeo: ${width}x${height}`);
        
        // Técnicas para remover marca d'água (geralmente fica nos cantos)
        // Vamos tentar múltiplas técnicas e usar a que funcionar melhor
        
        // TÉCNICA 1: Delogo - Remove logo/marca d'água de uma região específica
        // A marca d'água da Shopee geralmente fica no canto inferior direito
        // Vamos tentar remover de várias posições possíveis
        
        const delogoFilters = [];
        
        // Canto inferior direito (mais comum)
        const logoSize = Math.min(width, height) * 0.15; // ~15% do tamanho menor
        const x = width - logoSize - 10;
        const y = height - logoSize - 10;
        delogoFilters.push(`delogo=x=${x}:y=${y}:w=${logoSize}:h=${logoSize}`);
        
        // Canto inferior esquerdo (caso alternativo)
        delogoFilters.push(`delogo=x=10:y=${height - logoSize - 10}:w=${logoSize}:h=${logoSize}`);
        
        // Canto superior direito
        delogoFilters.push(`delogo=x=${width - logoSize - 10}:y=10:w=${logoSize}:h=${logoSize}`);
        
        // TÉCNICA 2: Crop inteligente - Cortar bordas onde geralmente fica marca d'água
        // Mas manter a maior parte do vídeo
        const cropMargin = Math.min(width, height) * 0.05; // 5% de margem
        
        // TÉCNICA 3: Overlay com blur - Cobrir a marca d'água com blur
        const blurOverlay = `[0:v]crop=${logoSize}:${logoSize}:${x}:${y},boxblur=10[blurred];[0:v][blurred]overlay=${x}:${y}`;
        
        // Vamos tentar a técnica mais simples primeiro: delogo no canto inferior direito
        const filterComplex = delogoFilters[0];
        
        console.log(`🔧 Aplicando filtro delogo na região: x=${x}, y=${y}, w=${logoSize}, h=${logoSize}`);
        
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
          .audioCodec('copy') // Manter áudio original
          .outputOptions([
            '-preset medium',
            '-crf 20',
            '-movflags +faststart',
            '-pix_fmt yuv420p'
          ])
          .on('start', (commandLine) => {
            console.log('🚀 FFmpeg iniciado (remoção de marca d'água):', commandLine.substring(0, 100) + '...');
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`⏳ Removendo marca d'água: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', () => {
            console.log('✅ Marca d'água removida com sucesso!');
            resolve(outputPath);
          })
          .on('error', (err) => {
            console.warn('⚠️ Erro ao remover marca d'água com delogo:', err.message);
            console.log('📋 Tentando técnica alternativa: crop inteligente...');
            
            // TÉCNICA ALTERNATIVA: Crop (mais simples, mas pode cortar parte do vídeo)
            // Só cortar uma pequena margem inferior onde geralmente fica a marca
            const cropHeight = height - Math.round(logoSize);
            
            ffmpeg(inputPath)
              .videoFilters([
                {
                  filter: 'crop',
                  options: {
                    w: width,
                    h: cropHeight,
                    x: 0,
                    y: 0
                  }
                }
              ])
              .videoCodec('libx264')
              .audioCodec('copy')
              .outputOptions([
                '-preset medium',
                '-crf 20',
                '-movflags +faststart',
                '-pix_fmt yuv420p'
              ])
              .on('end', () => {
                console.log('✅ Marca d'água removida usando crop!');
                resolve(outputPath);
              })
              .on('error', (err2) => {
                console.warn('⚠️ Erro ao remover marca d'água:', err2.message);
                // Se falhar, copiar o arquivo original
                console.log('📋 Usando vídeo original (sem remoção de marca d'água)');
                fs.copyFileSync(inputPath, outputPath);
                resolve(outputPath);
              })
              .save(outputPath);
          })
          .save(outputPath);
          
      } catch (error) {
        console.error('❌ Erro ao processar remoção de marca d'água:', error.message);
        // Se der erro, copiar o arquivo original
        fs.copyFileSync(inputPath, outputPath);
        resolve(outputPath);
      }
    });
  }

  async enhanceVideo(inputPath, outputPath) {
    return new Promise(async (resolve, reject) => {
      console.log('🎬 Iniciando otimização do vídeo (sem alterar resolução)...');
      
      // Verificar se ffmpeg está disponível
      try {
        execSync('which ffmpeg', { encoding: 'utf-8' });
        console.log('✅ FFmpeg encontrado');
      } catch (e) {
        console.warn('⚠️ FFmpeg não encontrado, usando arquivo original');
        // Se não tiver ffmpeg, apenas copiar o arquivo
        fs.copyFileSync(inputPath, outputPath);
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
        resolve(outputPath);
        return;
      }

      try {
        // Obter informações do vídeo original
        const videoInfo = await this.getVideoInfo(inputPath);
        console.log(`📐 Resolução original: ${videoInfo.width}x${videoInfo.height}`);
        
        // MANTER a resolução original - apenas garantir que dimensões sejam pares (requisito H.264)
        let targetWidth = videoInfo.width;
        let targetHeight = videoInfo.height;
        
        if (targetWidth % 2 !== 0) {
          targetWidth += 1;
        }
        if (targetHeight % 2 !== 0) {
          targetHeight += 1;
        }
        
        // Se precisou ajustar, usar scale apenas para corrigir paridade
        const needsScale = targetWidth !== videoInfo.width || targetHeight !== videoInfo.height;
        const scaleFilter = needsScale ? `scale=${targetWidth}:${targetHeight}` : null;
        
        console.log(`✨ Mantendo resolução original ${videoInfo.width}x${videoInfo.height} (sem upscaling)`);
        if (needsScale) {
          console.log(`🔧 Ajustando para ${targetWidth}x${targetHeight} (apenas para compatibilidade H.264)`);
        }

        // Configurar ffmpeg SEM upscaling - apenas otimização de codec
        const outputOptions = [
          '-preset medium', // Balance entre velocidade e qualidade
          '-crf 20', // Qualidade alta (menor = melhor, 18-23 é ideal)
          '-movflags +faststart', // Otimização para streaming
          '-pix_fmt yuv420p', // Formato compatível
          '-profile:v high', // Perfil H.264 de alta qualidade
          '-level 4.0',
          '-b:a 192k' // Áudio de alta qualidade
        ];
        
        // Adicionar scale apenas se necessário para corrigir paridade
        if (scaleFilter) {
          outputOptions.push(`-vf ${scaleFilter}`);
        }
        
        ffmpeg(inputPath)
          .videoCodec('libx264')
          .audioCodec('aac')
          .outputOptions(outputOptions)
          .on('start', (commandLine) => {
            console.log('🚀 FFmpeg iniciado:', commandLine);
          })
          .on('progress', (progress) => {
            if (progress.percent) {
              console.log(`⏳ Processando: ${Math.round(progress.percent)}%`);
            }
          })
          .on('end', async () => {
            console.log('✅ Vídeo otimizado com sucesso (resolução original mantida)!');
            
            // Verificar resolução final
            try {
              const finalInfo = await this.getVideoInfo(outputPath);
              console.log(`📐 Resolução final: ${finalInfo.width}x${finalInfo.height}`);
            } catch (e) {
              console.warn('Não foi possível verificar resolução final:', e.message);
            }
            
            // Remover arquivo original
            if (fs.existsSync(inputPath)) {
              fs.unlinkSync(inputPath);
            }
            resolve(outputPath);
          })
          .on('error', (err) => {
            console.error('❌ Erro ao processar vídeo:', err.message);
            // Se der erro, usar o arquivo original
            if (fs.existsSync(inputPath)) {
              console.log('📋 Usando arquivo original devido ao erro');
              fs.copyFileSync(inputPath, outputPath);
              fs.unlinkSync(inputPath);
              resolve(outputPath);
            } else {
              reject(err);
            }
          })
          .save(outputPath);
          
      } catch (error) {
        console.error('❌ Erro ao obter informações do vídeo:', error.message);
        console.log('📋 Usando arquivo original sem processamento');
        // Se não conseguir obter info, apenas copiar o arquivo
        if (fs.existsSync(inputPath)) {
          fs.copyFileSync(inputPath, outputPath);
          fs.unlinkSync(inputPath);
          resolve(outputPath);
        } else {
          reject(error);
        }
      }
    });
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
      const originalFilename = `shopee_video_${userId}_${timestamp}_original.mp4`;
      const enhancedFilename = `shopee_video_${userId}_${timestamp}.mp4`;
      
      // Baixar vídeo
      const originalPath = await this.downloadVideo(videoUrl, originalFilename);
      
      // Verificar resolução real do vídeo baixado
      try {
        const videoInfo = await this.getVideoInfo(originalPath);
        const height = videoInfo.height;
        let detectedQuality = 'desconhecida';
        
        if (height >= 1080) {
          detectedQuality = '1080p';
        } else if (height >= 720) {
          detectedQuality = '720p';
        } else if (height >= 480) {
          detectedQuality = '480p';
        } else if (height >= 360) {
          detectedQuality = '360p';
        } else {
          detectedQuality = `${height}p`;
        }
        
        console.log(`📐 Resolução real do vídeo baixado: ${videoInfo.width}x${videoInfo.height} (${detectedQuality})`);
        
        // Se não for pelo menos 720p, avisar (mas não falhar)
        if (height < 720) {
          console.warn(`⚠️ ATENÇÃO: Vídeo baixado em ${detectedQuality}, não em 720p ou superior.`);
          console.warn(`   Isso pode acontecer se a Shopee não disponibilizar vídeo em melhor qualidade para usuários não logados.`);
          console.warn(`   Solução: Configure cookies de sessão via variável SHOPEE_COOKIES para acessar vídeos em melhor qualidade.`);
        } else {
          console.log(`✅ Vídeo baixado em ${detectedQuality} - qualidade adequada!`);
        }
      } catch (e) {
        console.warn('⚠️ Não foi possível verificar resolução do vídeo:', e.message);
      }
      
        // Melhorar qualidade do vídeo
        const enhancedPath = path.join(this.videosDir, enhancedFilename);
        await this.enhanceVideo(originalPath, enhancedPath);
        
        // REMOVER MARCA D'ÁGUA (como o bot concorrente faz!)
        const noWatermarkFilename = `shopee_video_${userId}_${timestamp}_nowm.mp4`;
        const noWatermarkPath = path.join(this.videosDir, noWatermarkFilename);
        console.log('🎨 Iniciando remoção de marca d'água...');
        await this.removeWatermark(enhancedPath, noWatermarkPath);
        
        // Usar o vídeo sem marca d'água como final
        return {
          success: true,
          filePath: noWatermarkPath,
          filename: noWatermarkFilename
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

