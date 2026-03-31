const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth } = require('whatsapp-web.js');
require('dotenv').config();

const botPrefix = process.env.BOT_PREFIX || '!';
const blockLinks = String(process.env.BLOCK_LINKS || 'true') === 'true';
const ignoreAdmins = String(process.env.IGNORE_ADMINS || 'true') === 'true';
const welcomeNewMembers = String(process.env.WELCOME_NEW_MEMBERS || 'true') === 'true';
const leaveMessageForBlockedLink = String(process.env.LEAVE_MESSAGE_FOR_BLOCKED_LINK || 'true') === 'true';
const antiSpamEnabled = String(process.env.ANTI_SPAM_ENABLED || 'true') === 'true';
const antiSpamMaxMessages = Number.parseInt(process.env.ANTI_SPAM_MAX_MESSAGES || '5', 10);
const antiSpamWindowMs = Number.parseInt(process.env.ANTI_SPAM_WINDOW_MS || '10000', 10);
const antiSpamDeleteMessage = String(process.env.ANTI_SPAM_DELETE_MESSAGE || 'true') === 'true';
const antiSpamWarnUser = String(process.env.ANTI_SPAM_WARN_USER || 'true') === 'true';
const pairingPhoneNumber = String(process.env.PAIR_WITH_PHONE_NUMBER || '').replace(/\D/g, '');
const pairingShowNotification = String(process.env.PAIRING_SHOW_NOTIFICATION || 'true') === 'true';
const pairingIntervalMs = Number.parseInt(process.env.PAIRING_INTERVAL_MS || '180000', 10);
const puppeteerExecutablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
const puppeteerHeadless = process.env.PUPPETEER_HEADLESS || 'true';

const sessionPath = path.resolve('.session');
if (!fs.existsSync(sessionPath)) {
  fs.mkdirSync(sessionPath, { recursive: true });
}

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: sessionPath,
    clientId: 'bot-grupo'
  }),
  ...(pairingPhoneNumber ? {
    pairWithPhoneNumber: {
      phoneNumber: pairingPhoneNumber,
      showNotification: pairingShowNotification,
      intervalMs: Number.isFinite(pairingIntervalMs) && pairingIntervalMs > 0 ? pairingIntervalMs : 180000
    }
  } : {}),
  puppeteer: {
    headless: puppeteerHeadless === 'true' ? true : puppeteerHeadless,
    ...(puppeteerExecutablePath ? { executablePath: puppeteerExecutablePath } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  }
});


function containsLink(texto) {
  if (!texto) return false;

  const regexDeLinks = /((https?:\/\/)|(www\.)|([a-zA-Z0-9-]+\.(com|com\.br|net|org|io|gg|dev|app|info|co|me|ly|gl|tv|xyz|online|store|site|blog|edu|gov)(\/[^\s]*)?))/gi;
  return regexDeLinks.test(texto);
}


function normalizeJid(id) {
  if (!id || typeof id !== 'string') return '';

  const [usuario = ''] = id.split('@');
  return usuario.trim().toLowerCase();
}


function extractDigits(value) {
  if (!value) return '';
  return value.replace(/\D/g, '');
}


function isSameWhatsAppUser(leftId, rightId) {
  if (!leftId || !rightId) return false;
  if (leftId === rightId) return true;

  const leftNormalized = normalizeJid(leftId);
  const rightNormalized = normalizeJid(rightId);

  if (leftNormalized && leftNormalized === rightNormalized) return true;

  const leftDigits = extractDigits(leftNormalized);
  const rightDigits = extractDigits(rightNormalized);

  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}


function getMessageUniqueId(message) {
  return message?.id?._serialized || message?.id?.id || null;
}


function parsePositiveInteger(value, fallbackValue) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}


function getSpamTrackerKey(chatId, senderId) {
  if (!chatId || !senderId) return '';
  return `${chatId}:${senderId}`;
}


function isSpamMessage(history, now, maxMessages, windowMs) {
  const validWindowMs = parsePositiveInteger(windowMs, 10000);
  const validMaxMessages = parsePositiveInteger(maxMessages, 5);
  const recentMessages = history.filter((timestamp) => now - timestamp <= validWindowMs);
  return {
    recentMessages,
    exceeded: recentMessages.length >= validMaxMessages
  };
}


function buildSpamStatusMessage(isEnabled, maxMessages, windowMs) {
  return `🤖 Anti-spam: ${isEnabled ? 'ativado' : 'desativado'} | limite: ${maxMessages} mensagem(ns) em ${Math.floor(windowMs / 1000)} segundo(s).`;
}



async function isSenderAdmin(chat, authorId) {
  if (!chat.isGroup || !authorId) return false;

  try {
    const isAdminFromBrowser = await chat.client.pupPage.evaluate(async (chatId, participantId) => {
      const chatModel = await window.WWebJS.getChat(chatId, { getAsModel: false });
      if (!chatModel?.groupMetadata?.participants) return false;

      const { lid, phone } = await window.WWebJS.enforceLidAndPnRetrieval(participantId);
      const participante =
        chatModel.groupMetadata.participants.get(lid?._serialized) ||
        chatModel.groupMetadata.participants.get(phone?._serialized);

      return Boolean(participante?.isAdmin || participante?.isSuperAdmin);
    }, chat.id._serialized, authorId);

    if (isAdminFromBrowser) return true;

    const participantes = chat.participants || [];
    const participanteEncontrado = participantes.find((participante) => {
      const participantId = participante?.id?._serialized;
      return isSameWhatsAppUser(participantId, authorId);
    });

    if (!participanteEncontrado) return false;

    return participanteEncontrado.isAdmin || participanteEncontrado.isSuperAdmin || false;
  } catch (erro) {
    console.error('Erro ao verificar admin:', erro.message);
    return false;
  }
}


function buildHelpMessage() {
  return [
    '🤖 *Comandos disponíveis*',
    '',
    `${botPrefix}ping - testa se o bot está online`,
    `${botPrefix}menu - mostra este menu`,
    `${botPrefix}id - mostra o ID do grupo`,
    `${botPrefix}links on - ativa bloqueio de links`,
    `${botPrefix}links off - desativa bloqueio de links`,
    `${botPrefix}spam on - ativa o anti-spam`,
    `${botPrefix}spam off - desativa o anti-spam`,
    `${botPrefix}spam status - mostra a configuração atual do anti-spam`,
    `${botPrefix}spam 5 10 - permite 5 mensagens em 10 segundos`,
    '',
    'Obs.: os comandos de configuração funcionam melhor quando enviados por administradores.'
  ].join('\n');
}


let blockLinksRuntime = blockLinks;
let antiSpamEnabledRuntime = antiSpamEnabled;
let antiSpamMaxMessagesRuntime = parsePositiveInteger(antiSpamMaxMessages, 5);
let antiSpamWindowMsRuntime = parsePositiveInteger(antiSpamWindowMs, 10000);
const processedMessages = new Set();
const spamTracker = new Map();

client.on('qr', (qr) => {
  console.log('Escaneie o QR Code abaixo com o WhatsApp:');
  qrcode.generate(qr, { small: true });
});

client.on('code', (code) => {
  console.log(`Codigo de pareamento: ${code}`);
});

client.on('loading_screen', (percentual, mensagem) => {
  console.log(`Carregando: ${percentual}% - ${mensagem}`);
});

client.on('authenticated', () => {
  console.log('Autenticado com sucesso.');
});

client.on('ready', () => {
  console.log('Bot conectado e pronto para uso.');
});

client.on('auth_failure', (mensagem) => {
  console.error('Falha na autenticação:', mensagem);
});

client.on('disconnected', (motivo) => {
  console.log('Bot desconectado:', motivo);
});


client.on('group_join', async (notificacao) => {
  if (!welcomeNewMembers) return;

  try {
    const chat = await notificacao.getChat();
    const contatosAdicionados = notificacao.recipientIds || [];

    for (const contatoId of contatosAdicionados) {
      await chat.sendMessage(`👋 Seja bem-vindo(a), @${contatoId.split('@')[0]}! Leia as regras do grupo e fique à vontade.`, {
        mentions: [contatoId]
      });
    }
  } catch (erro) {
    console.error('Erro ao dar boas-vindas:', erro.message);
  }
});


client.on('message', async (message) => {
  try {
    const messageUniqueId = getMessageUniqueId(message);
    if (messageUniqueId && processedMessages.has(messageUniqueId)) return;

    if (messageUniqueId) {
      processedMessages.add(messageUniqueId);

      // Limpa IDs antigos para evitar crescimento infinito em memória.
      setTimeout(() => {
        processedMessages.delete(messageUniqueId);
      }, 5 * 60 * 1000);
    }

    if (message.fromMe) return;

    const chat = await message.getChat();
    if (!chat.isGroup) return;

    const texto = (message.body || '').trim();
    const remetenteId = message.author || message.from;
    const remetenteAdmin = await isSenderAdmin(chat, remetenteId);

    if (blockLinksRuntime && containsLink(texto)) {
      if (!(ignoreAdmins && remetenteAdmin)) {
        try {
          await message.delete(true);
        } catch (erroAoApagar) {
          console.error('Não foi possível apagar a mensagem com link:', erroAoApagar.message);
        }

        if (leaveMessageForBlockedLink) {
          await chat.sendMessage(`🚫 @${remetenteId.split('@')[0]}, links não são permitidos neste grupo.`, {
            mentions: [remetenteId]
          });
        }

        return;
      }
    }

    if (antiSpamEnabledRuntime && texto) {
      const shouldIgnoreSpamRule = ignoreAdmins && remetenteAdmin;

      if (!shouldIgnoreSpamRule) {
        const spamTrackerKey = getSpamTrackerKey(chat.id._serialized, remetenteId);
        const now = Date.now();
        const messageHistory = spamTracker.get(spamTrackerKey) || [];
        const { recentMessages, exceeded } = isSpamMessage(
          messageHistory,
          now,
          antiSpamMaxMessagesRuntime,
          antiSpamWindowMsRuntime
        );
        recentMessages.push(now);
        spamTracker.set(spamTrackerKey, recentMessages);

        setTimeout(() => {
          const currentHistory = spamTracker.get(spamTrackerKey) || [];
          const freshHistory = currentHistory.filter((timestamp) => Date.now() - timestamp <= antiSpamWindowMsRuntime);

          if (freshHistory.length > 0) {
            spamTracker.set(spamTrackerKey, freshHistory);
            return;
          }

          spamTracker.delete(spamTrackerKey);
        }, antiSpamWindowMsRuntime);

        if (exceeded) {
          if (antiSpamDeleteMessage) {
            try {
              await message.delete(true);
            } catch (erroAoApagar) {
              console.error('Não foi possível apagar a mensagem por spam:', erroAoApagar.message);
            }
          }

          if (antiSpamWarnUser) {
            await chat.sendMessage(`🚫 @${remetenteId.split('@')[0]}, pare com o spam.`, {
              mentions: [remetenteId]
            });
          }

          return;
        }
      }
    }

    if (!texto.startsWith(botPrefix)) return;

    const comandoCompleto = texto.slice(botPrefix.length).trim();
    const comandoNormalizado = comandoCompleto.toLowerCase();
    const comandoPartes = comandoCompleto.split(/\s+/).filter(Boolean);

    if (comandoNormalizado === 'ping') {
      await message.reply('🏓 Pong! Estou online.');
      return;
    }

    if (comandoNormalizado === 'menu' || comandoNormalizado === 'ajuda' || comandoNormalizado === 'help') {
      await message.reply(buildHelpMessage());
      return;
    }

    if (comandoNormalizado === 'id') {
      await message.reply(`🆔 ID do grupo: ${chat.id._serialized}`);
      return;
    }

    if (comandoNormalizado === 'spam on') {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem ativar o anti-spam.');
        return;
      }

      antiSpamEnabledRuntime = true;
      await message.reply(`✅ ${buildSpamStatusMessage(antiSpamEnabledRuntime, antiSpamMaxMessagesRuntime, antiSpamWindowMsRuntime)}`);
      return;
    }

    if (comandoNormalizado === 'spam off') {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem desativar o anti-spam.');
        return;
      }

      antiSpamEnabledRuntime = false;
      await message.reply('✅ Anti-spam desativado.');
      return;
    }

    if (comandoNormalizado === 'spam status') {
      await message.reply(buildSpamStatusMessage(antiSpamEnabledRuntime, antiSpamMaxMessagesRuntime, antiSpamWindowMsRuntime));
      return;
    }

    if (comandoPartes[0]?.toLowerCase() === 'spam' && comandoPartes.length === 3) {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem alterar a configuração do anti-spam.');
        return;
      }

      const novoLimite = parsePositiveInteger(comandoPartes[1], 0);
      const novaJanelaSegundos = parsePositiveInteger(comandoPartes[2], 0);

      if (!novoLimite || !novaJanelaSegundos) {
        await message.reply(`❌ Use no formato: ${botPrefix}spam 5 10`);
        return;
      }

      antiSpamEnabledRuntime = true;
      antiSpamMaxMessagesRuntime = novoLimite;
      antiSpamWindowMsRuntime = novaJanelaSegundos * 1000;
      spamTracker.clear();

      await message.reply(`✅ ${buildSpamStatusMessage(antiSpamEnabledRuntime, antiSpamMaxMessagesRuntime, antiSpamWindowMsRuntime)}`);
      return;
    }

    if (comandoNormalizado === 'links on') {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem ativar o bloqueio de links.');
        return;
      }

      blockLinksRuntime = true;
      await message.reply('✅ Bloqueio de links ativado.');
      return;
    }

    if (comandoNormalizado === 'links off') {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem desativar o bloqueio de links.');
        return;
      }

      blockLinksRuntime = false;
      await message.reply('✅ Bloqueio de links desativado.');
      return;
    }
  } catch (erro) {
    console.error('Erro ao processar mensagem:', erro);
  }
});
client.initialize();
