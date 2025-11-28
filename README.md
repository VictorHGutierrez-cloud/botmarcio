# 🤖 Bot de Download de Vídeos da Shopee

Bot do Telegram que permite baixar vídeos da Shopee automaticamente. Oferece 20 downloads gratuitos e depois requer assinatura premium mensal.

## 🚀 Instalação Rápida

### 1. Clone o repositório
```bash
git clone https://github.com/VictorHGutierrez-cloud/botmarcio.git
cd botmarcio
```

### 2. Instale as dependências
```bash
npm install
```

### 3. Configure o bot
1. Crie um arquivo `.env` na raiz do projeto
2. Adicione seu token do bot:
```
BOT_TOKEN=seu_token_aqui
```

### 4. Execute o bot
```bash
npm start
```

## 📋 Requisitos

- Node.js (versão 14 ou superior)
- Token do Bot do Telegram (obtido através do @BotFather)

## 🔧 Configuração

### Obter Token do Bot

1. Abra o Telegram e procure por `@BotFather`
2. Envie o comando `/newbot`
3. Siga as instruções para criar seu bot
4. Copie o token fornecido pelo BotFather
5. Cole no arquivo `.env`

## 📱 Como Usar

1. Abra o Telegram e procure pelo seu bot
2. Envie o comando `/start` para iniciar
3. Envie um link de vídeo da Shopee
4. O bot irá processar e enviar o vídeo baixado

### Comandos Disponíveis

- `/start` - Iniciar o bot
- `/help` - Ver ajuda
- `/stats` - Ver estatísticas de uso
- `/premium` - Informações sobre plano premium

## 💎 Sistema de Freemium

- **Plano Gratuito**: 20 downloads gratuitos
- **Plano Premium**: Downloads ilimitados por 30 dias

## 🏗️ Estrutura do Projeto

```
.
├── bot.js                 # Código principal do bot
├── database.js            # Gerenciamento de banco de dados
├── shopee-downloader.js   # Função para baixar vídeos
├── package.json           # Dependências
├── env.example            # Exemplo de configuração
└── README.md              # Este arquivo
```

## 🚀 Deploy no Railway

Este bot está configurado para deploy no Railway:

1. Conecte este repositório ao Railway
2. Configure a variável de ambiente `BOT_TOKEN`
3. O Railway fará o deploy automaticamente

## 📝 Notas

- Os vídeos baixados são armazenados temporariamente
- O banco de dados SQLite é criado automaticamente
- Certifique-se de cumprir os termos de uso da Shopee e do Telegram

## 📄 Licença

MIT
