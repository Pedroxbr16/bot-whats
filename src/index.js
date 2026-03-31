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
    '',
    'Obs.: os comandos de configuração funcionam melhor quando enviados por administradores.'
  ].join('\n');
}


let blockLinksRuntime = blockLinks;
const processedMessages = new Set();

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
    if (!texto.startsWith(botPrefix)) return;

    const comandoCompleto = texto.slice(botPrefix.length).trim();
    const comandoNormalizado = comandoCompleto.toLowerCase();

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
