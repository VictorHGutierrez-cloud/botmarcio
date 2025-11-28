require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const Database = require('./database');
const ShopeeDownloader = require('./shopee-downloader');
const fs = require('fs');
const path = require('path');

// Verificar se o token do bot está configurado
if (!process.env.BOT_TOKEN) {
  console.error('ERRO: BOT_TOKEN não encontrado no arquivo .env');
  console.error('Por favor, crie um arquivo .env com seu token do bot do Telegram');
  process.exit(1);
}

// Inicializar o bot
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const downloader = new ShopeeDownloader();

// Mensagem de boas-vindas
const WELCOME_MESSAGE = `
🎬 *Bem-vindo ao Bot de Download de Vídeos da Shopee!*

📥 *Como usar:*
1. Envie um link de vídeo da Shopee
2. O bot irá baixar o vídeo automaticamente
3. Você receberá o vídeo pronto para postar!

🆓 *Plano Gratuito:*
• 20 downloads gratuitos
• Depois disso, assine o plano premium

💎 *Plano Premium:*
• Downloads ilimitados
• Válido por 30 dias
• Taxa mensal

📊 Use /stats para ver suas estatísticas
💳 Use /premium para assinar o plano premium
ℹ️ Use /help para ver todos os comandos
`;

// Comando /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const username = msg.from.username;
  const firstName = msg.from.first_name;

  try {
    // Criar ou obter usuário
    await Database.getUser(userId, username, firstName);
    
    await bot.sendMessage(chatId, WELCOME_MESSAGE, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Erro ao processar /start:', error);
    await bot.sendMessage(chatId, '❌ Erro ao inicializar o bot. Tente novamente mais tarde.');
  }
});

// Comando /help
bot.onText(/\/help/, async (msg) => {
  const chatId = msg.chat.id;
  console.log('Comando /help recebido de:', msg.from.id);
  
  try {
    const helpText = `
📋 *Comandos Disponíveis:*

/start - Iniciar o bot
/help - Ver esta mensagem de ajuda
/stats - Ver suas estatísticas de uso
/premium - Informações sobre o plano premium

📥 *Como baixar vídeos:*
Simplesmente envie um link de vídeo da Shopee e o bot fará o download automaticamente!

Exemplo de link:
\`https://shopee.com.br/universal-link?redir=...\`
    `;

    await bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Erro ao processar /help:', error);
    await bot.sendMessage(chatId, '❌ Erro ao processar comando. Tente novamente.');
  }
});

// Comando /stats
bot.onText(/\/stats/, async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  console.log('Comando /stats recebido de:', userId);

  try {
    const stats = await Database.getStats(userId);
    const FREE_LIMIT = 20;
    const remaining = Math.max(0, FREE_LIMIT - stats.downloads_count);
    
    let statsText = `📊 *Suas Estatísticas:*\n\n`;
    statsText += `📥 Downloads realizados: *${stats.downloads_count}*\n`;
    statsText += `🆓 Downloads restantes (gratuito): *${remaining}*\n`;
    
    if (stats.is_premium === 1 && stats.premium_expires_at) {
      const expiresAt = new Date(stats.premium_expires_at);
      const now = new Date();
      if (expiresAt > now) {
        const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
        statsText += `💎 Status: *Premium Ativo*\n`;
        statsText += `⏰ Expira em: *${daysLeft} dias*\n`;
      } else {
        statsText += `💎 Status: *Premium Expirado*\n`;
      }
    } else {
      statsText += `💎 Status: *Plano Gratuito*\n`;
    }

    await bot.sendMessage(chatId, statsText, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Erro ao obter estatísticas:', error);
    await bot.sendMessage(chatId, '❌ Erro ao obter estatísticas. Tente novamente mais tarde.');
  }
});

// Comando /premium
bot.onText(/\/premium/, async (msg) => {
  const chatId = msg.chat.id;
  console.log('Comando /premium recebido de:', msg.from.id);
  
  try {
    const premiumText = `
💎 *Plano Premium*

Com o plano premium você tem:
✅ Downloads ilimitados
✅ Válido por 30 dias
✅ Sem limites de uso

💰 *Valor:* R$ 29,90/mês

Para assinar, entre em contato com o administrador ou use o comando:
/premium_activate [código]

*Nota:* Em produção, você deve integrar com um sistema de pagamento (PIX, cartão, etc.)
    `;

    await bot.sendMessage(chatId, premiumText, { parse_mode: 'Markdown' });
  } catch (error) {
    console.error('Erro ao processar /premium:', error);
    await bot.sendMessage(chatId, '❌ Erro ao processar comando. Tente novamente.');
  }
});

// Comando /premium_activate (apenas para testes - em produção, use sistema de pagamento real)
bot.onText(/\/premium_activate (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const code = match[1];

  // Em produção, você deve validar o código de pagamento aqui
  // Por enquanto, aceitamos qualquer código para testes
  if (code === 'TESTE123' || code === 'teste') {
    try {
      const expiresAt = await Database.activatePremium(userId, 30);
      await bot.sendMessage(
        chatId,
        `✅ *Premium Ativado!*\n\nSeu plano premium está ativo até ${expiresAt.toLocaleDateString('pt-BR')}.\n\nAgora você pode baixar vídeos ilimitados! 🎉`,
        { parse_mode: 'Markdown' }
      );
    } catch (error) {
      console.error('Erro ao ativar premium:', error);
      await bot.sendMessage(chatId, '❌ Erro ao ativar premium. Tente novamente.');
    }
  } else {
    await bot.sendMessage(
      chatId,
      '❌ Código inválido. Use "TESTE123" para testar (apenas em desenvolvimento).'
    );
  }
});

// Processar links da Shopee
// IMPORTANTE: Este handler deve vir DEPOIS dos handlers onText para não interferir
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text;

  // Ignorar comandos (deixar os handlers onText processarem)
  if (text && text.startsWith('/')) {
    console.log('Comando ignorado pelo handler de mensagens:', text);
    return;
  }

  // Verificar se é um link da Shopee
  if (text && (text.includes('shopee.com.br') || text.includes('shopee'))) {
    try {
      // Verificar se o usuário pode baixar
      const canDownload = await Database.canDownload(userId);
      
      if (!canDownload.canDownload) {
        await bot.sendMessage(
          chatId,
          `❌ *Limite de downloads atingido!*\n\n` +
          `Você já usou ${canDownload.used} dos ${canDownload.limit} downloads gratuitos.\n\n` +
          `💎 Assine o plano premium para downloads ilimitados!\n` +
          `Use /premium para mais informações.`,
          { parse_mode: 'Markdown' }
        );
        return;
      }

      // Informar ao usuário que está processando
      const processingMsg = await bot.sendMessage(
        chatId,
        `⏳ Processando link da Shopee...\n\n` +
        (canDownload.reason === 'free' 
          ? `🆓 Downloads restantes: ${canDownload.remaining}`
          : `💎 Plano Premium Ativo`)
      );

      // Processar o link
      const result = await downloader.processShopeeLink(text, userId);

      if (result.success) {
        // Enviar vídeo
        const videoStream = fs.createReadStream(result.filePath);
        
        await bot.sendVideo(chatId, videoStream, {
          caption: `✅ Vídeo baixado com sucesso!\n\n` +
                   (canDownload.reason === 'free' 
                     ? `🆓 Downloads restantes: ${canDownload.remaining - 1}`
                     : `💎 Plano Premium`)
        });

        // Incrementar contador de downloads
        await Database.incrementDownload(userId, text);

        // Remover arquivo após enviar
        setTimeout(() => {
          if (fs.existsSync(result.filePath)) {
            fs.unlinkSync(result.filePath);
          }
        }, 5000);

        // Deletar mensagem de processamento
        await bot.deleteMessage(chatId, processingMsg.message_id);

      } else {
        await bot.editMessageText(
          `❌ Erro ao processar vídeo: ${result.error}\n\n` +
          `Certifique-se de que o link é válido e tente novamente.`,
          {
            chat_id: chatId,
            message_id: processingMsg.message_id
          }
        );
      }

    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
      await bot.sendMessage(
        chatId,
        '❌ Erro ao processar o link. Tente novamente mais tarde.'
      );
    }
  } else if (text) {
    // Mensagem que não é um link da Shopee
    await bot.sendMessage(
      chatId,
      '📎 Por favor, envie um link de vídeo da Shopee para fazer o download.\n\n' +
      'Exemplo:\n' +
      '`https://shopee.com.br/universal-link?redir=...`\n\n' +
      'Use /help para ver todos os comandos disponíveis.',
      { parse_mode: 'Markdown' }
    );
  }
});

// Tratamento de erros
bot.on('polling_error', (error) => {
  console.error('Erro no polling:', error);
});

// Limpar arquivos antigos periodicamente (a cada hora)
setInterval(() => {
  downloader.cleanupOldFiles(24); // Remove arquivos com mais de 24 horas
}, 60 * 60 * 1000);

// Log de inicialização
console.log('🤖 Bot iniciado com sucesso!');
console.log('📱 Aguardando mensagens...');
console.log('✅ Handlers registrados:');
console.log('   - /start');
console.log('   - /help');
console.log('   - /stats');
console.log('   - /premium');
console.log('   - /premium_activate');
console.log('   - message (links Shopee)');

// Verificar se o bot está funcionando
bot.getMe().then((botInfo) => {
  console.log(`✅ Bot conectado: @${botInfo.username}`);
}).catch((error) => {
  console.error('❌ Erro ao conectar bot:', error);
});

