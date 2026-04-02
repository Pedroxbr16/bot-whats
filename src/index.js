const fs = require('fs');
const path = require('path');
const qrcode = require('qrcode-terminal');
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
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
const tenorApiKey = 'LIVDSRZULELA';

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


function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}


function buildCommandQuery(commandParts) {
  return commandParts.slice(1).join(' ').trim();
}


function getRandomItem(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] || null;
}


function truncateText(value, maxLength = 500) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}


function upgradeAppleArtworkUrl(url) {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\./, '/1000x1000bb.');
}


function formatDurationMs(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}


function scoreTextMatch(query, candidate) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedCandidate = normalizeSearchText(candidate);

  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 100;
  if (normalizedCandidate.startsWith(normalizedQuery)) return 80;
  if (normalizedCandidate.includes(normalizedQuery)) return 60;
  if (normalizedQuery.includes(normalizedCandidate)) return 40;

  const queryWords = normalizedQuery.split(/\s+/).filter(Boolean);
  const candidateWords = normalizedCandidate.split(/\s+/).filter(Boolean);
  const matchingWords = queryWords.filter((word) => candidateWords.includes(word)).length;

  return matchingWords * 10;
}


async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}


async function sendMediaFromUrl(chat, mediaUrl, options = {}) {
  const media = await MessageMedia.fromUrl(mediaUrl, {
    unsafeMime: true,
    filename: options.filename
  });

  return chat.sendMessage(media, {
    quotedMessageId: options.quotedMessageId,
    caption: options.caption,
    mentions: options.mentions,
    sendMediaAsHd: options.sendMediaAsHd
  });
}


function extractTenorMediaUrl(result) {
  return result?.media_formats?.gif?.url ||
    result?.media_formats?.mediumgif?.url ||
    result?.media_formats?.tinygif?.url ||
    result?.media?.[0]?.gif?.url ||
    result?.media?.[0]?.mediumgif?.url ||
    result?.media?.[0]?.tinygif?.url ||
    '';
}


async function sendMemeFromInternet(chat, message, query) {
  const normalizedQuery = normalizeSearchText(query);
  const effectiveQuery = normalizedQuery || 'meme';

  try {
    const tenorUrl = new URL('https://g.tenor.com/v1/search');
    tenorUrl.searchParams.set('q', `${effectiveQuery} meme`);
    tenorUrl.searchParams.set('key', tenorApiKey);
    tenorUrl.searchParams.set('limit', '20');
    tenorUrl.searchParams.set('locale', 'pt_BR');
    tenorUrl.searchParams.set('contentfilter', 'medium');

    const tenorData = await fetchJson(tenorUrl.toString());
    const tenorResults = Array.isArray(tenorData?.results) ? tenorData.results : [];
    const selectedTenorResult = getRandomItem(tenorResults);
    const tenorMediaUrl = extractTenorMediaUrl(selectedTenorResult);

    if (tenorMediaUrl) {
      await sendMediaFromUrl(chat, tenorMediaUrl, {
        filename: `meme-${selectedTenorResult?.id || Date.now()}.gif`,
        caption: `🤣 Meme: ${query || 'aleatorio'}`,
        quotedMessageId: message.id._serialized
      });
      return;
    }
  } catch (erro) {
    console.error('Erro ao buscar meme na Tenor:', erro.message);
  }

  try {
    const data = await fetchJson('https://api.imgflip.com/get_memes');
    const memes = Array.isArray(data?.data?.memes) ? data.data.memes : [];
    const filteredMemes = normalizedQuery
      ? memes.filter((meme) => normalizeSearchText(meme?.name).includes(normalizedQuery))
      : memes;

    const selectedMeme = getRandomItem(filteredMemes);
    if (!selectedMeme?.url) {
      await message.reply(query
        ? `❌ Não achei meme na internet para "${query}".`
        : '❌ Não achei meme na internet agora.');
      return;
    }

    await sendMediaFromUrl(chat, selectedMeme.url, {
      filename: `meme-${selectedMeme.id || Date.now()}.jpg`,
      caption: `🤣 Meme: ${selectedMeme.name || query || 'sem titulo'}`,
      quotedMessageId: message.id._serialized,
      sendMediaAsHd: true
    });
  } catch (erro) {
    console.error('Erro ao buscar meme na internet:', erro.message);
    await message.reply('❌ Não consegui buscar meme na internet agora.');
  }
}


async function searchItunes(term, entity, options = {}) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', term);
  url.searchParams.set('entity', entity);
  url.searchParams.set('limit', String(options.limit || 10));
  url.searchParams.set('country', options.country || 'BR');
  url.searchParams.set('lang', options.lang || 'pt_br');
  if (options.media) {
    url.searchParams.set('media', options.media);
  }

  const data = await fetchJson(url.toString());
  return Array.isArray(data?.results) ? data.results : [];
}


async function sendMusicFromInternet(chat, message, query) {
  if (!query) {
    await message.reply(`❌ Use no formato: ${botPrefix}musica nome da musica`);
    return;
  }

  try {
    const results = await searchItunes(query, 'song');
    const selectedTrack = results.find((track) => track?.previewUrl) || results[0];

    if (!selectedTrack) {
      await message.reply(`❌ Não achei música para "${query}".`);
      return;
    }

    const coverUrl = upgradeAppleArtworkUrl(selectedTrack.artworkUrl100);
    const infoMessage = [
      `🎵 *${selectedTrack.trackName || 'Musica'}*`,
      `👤 ${selectedTrack.artistName || 'Artista desconhecido'}`,
      selectedTrack.collectionName ? `💿 ${selectedTrack.collectionName}` : null,
      selectedTrack.trackTimeMillis ? `⏱️ ${formatDurationMs(selectedTrack.trackTimeMillis)}` : null,
      selectedTrack.trackViewUrl ? `🔗 ${selectedTrack.trackViewUrl}` : null
    ].filter(Boolean).join('\n');

    if (coverUrl) {
      await sendMediaFromUrl(chat, coverUrl, {
        filename: `musica-${selectedTrack.trackId || Date.now()}.jpg`,
        caption: infoMessage,
        quotedMessageId: message.id._serialized,
        sendMediaAsHd: true
      });
    } else {
      await chat.sendMessage(infoMessage, {
        quotedMessageId: message.id._serialized
      });
    }

    if (selectedTrack.previewUrl) {
      await sendMediaFromUrl(chat, selectedTrack.previewUrl, {
        filename: `preview-${selectedTrack.trackId || Date.now()}.m4a`,
        quotedMessageId: message.id._serialized
      });
    }
  } catch (erro) {
    console.error('Erro ao buscar musica na internet:', erro.message);
    await message.reply('❌ Não consegui buscar música na internet agora.');
  }
}


function getParticipantSerializedId(participant) {
  return participant?.id?._serialized || '';
}


async function resolveParticipantIdFromChat(chat, candidateId) {
  if (!chat?.isGroup || !candidateId) return '';

  const participantes = chat.participants || [];
  const participanteEncontrado = participantes.find((participante) => {
    return isSameWhatsAppUser(getParticipantSerializedId(participante), candidateId);
  });

  if (participanteEncontrado) {
    return getParticipantSerializedId(participanteEncontrado);
  }

  try {
    const participantId = await chat.client.pupPage.evaluate(async (chatId, targetId) => {
      const chatModel = await window.WWebJS.getChat(chatId, { getAsModel: false });
      if (!chatModel?.groupMetadata?.participants) return '';

      const { lid, phone } = await window.WWebJS.enforceLidAndPnRetrieval(targetId);
      const lidId = lid?._serialized || '';
      const phoneId = phone?._serialized || '';

      if (lidId && chatModel.groupMetadata.participants.get(lidId)) return lidId;
      if (phoneId && chatModel.groupMetadata.participants.get(phoneId)) return phoneId;

      return '';
    }, chat.id._serialized, candidateId);

    return typeof participantId === 'string' ? participantId : '';
  } catch (erro) {
    console.error('Erro ao localizar participante do grupo:', erro.message);
    return '';
  }
}


async function resolveCommandTargetId(chat, message, commandParts) {
  const candidateIds = [];
  const argumento = commandParts.slice(1).join(' ').trim();
  const argumentoNormalizado = argumento.toLowerCase();
  const remetenteId = message?.author || message?.from || '';

  if (['eu', 'me', 'meu', 'minha', 'mia'].includes(argumentoNormalizado) && remetenteId) {
    return remetenteId;
  }

  if (Array.isArray(message.mentionedIds) && message.mentionedIds.length > 0) {
    candidateIds.push(...message.mentionedIds.filter(Boolean));
  }

  if (message.hasQuotedMsg) {
    try {
      const quotedMessage = await message.getQuotedMessage();
      const quotedAuthorId = quotedMessage?.author || quotedMessage?.from;

      if (quotedAuthorId) {
        candidateIds.push(quotedAuthorId);
      }
    } catch (erro) {
      console.error('Erro ao obter a mensagem respondida para banimento:', erro.message);
    }
  }

  if (argumento) {
    const digits = extractDigits(argumento);

    if (digits) {
      candidateIds.push(`${digits}@c.us`, digits);
    } else {
      candidateIds.push(argumento);
    }
  }

  for (const candidateId of candidateIds) {
    const participantId = await resolveParticipantIdFromChat(chat, candidateId);
    if (participantId) return participantId;
  }

  return '';
}


function buildProfilePhotoLookupIds(targetId) {
  const lookupIds = [];
  if (targetId) {
    lookupIds.push(targetId);
  }

  const digits = extractDigits(targetId);
  if (digits) {
    lookupIds.push(`${digits}@c.us`);
    lookupIds.push(digits);
  }

  return [...new Set(lookupIds.filter(Boolean))];
}


async function getProfilePhotoCandidatesFromStore(lookupId) {
  try {
    const profileData = await client.pupPage.evaluate(async (contactId) => {
      const chatWid = window.Store.WidFactory.createWid(contactId);
      const collection = await window.Store.ProfilePicThumb.find(chatWid);
      if (!collection) return null;

      const entries = Object.entries(collection).filter(([, value]) => {
        return typeof value === 'string' && /^https?:\/\//i.test(value);
      });

      return {
        urls: entries.map(([key, value]) => ({ key, value }))
      };
    }, lookupId);

    if (!profileData?.urls?.length) return [];

    const priority = ['eurl', 'imgFull', 'img', 'url'];
    return profileData.urls
      .sort((left, right) => {
        const leftPriority = priority.findIndex((item) => item === left.key);
        const rightPriority = priority.findIndex((item) => item === right.key);
        const safeLeft = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
        const safeRight = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;
        return safeLeft - safeRight;
      })
      .map((item) => item.value);
  } catch (erro) {
    console.error(`Erro ao listar URLs da foto de perfil para ${lookupId}:`, erro.message);
    return [];
  }
}


async function getProfilePhotoThumbMediaFromStore(lookupId) {
  try {
    const thumbData = await client.pupPage.evaluate(async (contactId) => {
      const chatWid = window.Store.WidFactory.createWid(contactId);
      const base64 = await window.WWebJS.getProfilePicThumbToBase64(chatWid);

      if (!base64) return null;

      return {
        data: base64,
        mimetype: 'image/jpeg'
      };
    }, lookupId);

    if (!thumbData?.data) return null;

    return new MessageMedia(
      thumbData.mimetype || 'image/jpeg',
      thumbData.data,
      `foto-perfil-${extractDigits(lookupId) || 'contato'}.jpg`
    );
  } catch (erro) {
    console.error(`Erro ao buscar thumb da foto de perfil para ${lookupId}:`, erro.message);
    return null;
  }
}


async function downloadProfilePhotoMedia(photoUrl, lookupId) {
  if (!photoUrl) return null;

  const filename = `foto-perfil-${extractDigits(lookupId) || 'contato'}.jpg`;

  try {
    const browserMedia = await client.pupPage.evaluate(async (url) => {
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';

      for (const byte of bytes) {
        binary += String.fromCharCode(byte);
      }

      return {
        data: btoa(binary),
        mimetype: response.headers.get('content-type') || 'image/jpeg'
      };
    }, photoUrl);

    if (browserMedia?.data) {
      return new MessageMedia(browserMedia.mimetype, browserMedia.data, filename);
    }
  } catch (erro) {
    console.error(`Erro ao baixar foto de perfil no navegador para ${lookupId}:`, erro.message);
  }

  try {
    return await MessageMedia.fromUrl(photoUrl, {
      unsafeMime: true,
      filename
    });
  } catch (erro) {
    console.error(`Erro ao baixar foto de perfil no Node para ${lookupId}:`, erro.message);
    return null;
  }
}


async function resolveProfilePhotoMedia(targetId) {
  const lookupIds = buildProfilePhotoLookupIds(targetId);

  for (const lookupId of lookupIds) {
    try {
      const candidateUrls = await getProfilePhotoCandidatesFromStore(lookupId);
      for (const candidateUrl of candidateUrls) {
        const fotoPerfil = await downloadProfilePhotoMedia(candidateUrl, lookupId);
        if (!fotoPerfil) continue;

        return {
          media: fotoPerfil,
          resolvedId: lookupId
        };
      }

      const thumbMedia = await getProfilePhotoThumbMediaFromStore(lookupId);
      if (thumbMedia) {
        return {
          media: thumbMedia,
          resolvedId: lookupId
        };
      }
    } catch (erro) {
      console.error(`Erro ao buscar foto de perfil para ${lookupId}:`, erro.message);
    }
  }

  return null;
}


function clearSpamTrackerForUser(chatId, participantId) {
  if (!chatId || !participantId) return;

  const keyPrefix = `${chatId}:`;
  for (const spamKey of spamTracker.keys()) {
    if (!spamKey.startsWith(keyPrefix)) continue;

    const senderId = spamKey.slice(keyPrefix.length);
    if (isSameWhatsAppUser(senderId, participantId)) {
      spamTracker.delete(spamKey);
    }
  }
}



async function resolveStickerSourceMessage(message) {
  if (message?.hasMedia) return message;
  if (!message?.hasQuotedMsg) return null;

  try {
    const quotedMessage = await message.getQuotedMessage();
    return quotedMessage?.hasMedia ? quotedMessage : null;
  } catch (erro) {
    console.error('Erro ao obter a mensagem respondida para figurinha:', erro.message);
    return null;
  }
}


function isStickerCompatibleMedia(media) {
  if (!media?.mimetype) return false;
  return media.mimetype.includes('image') || media.mimetype.includes('video');
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
    `${botPrefix}menu / ${botPrefix}ajuda / ${botPrefix}help - mostra este menu`,
    `${botPrefix}id - mostra o ID do grupo`,
    `${botPrefix}pix - mostra a chave Pix para ajudar os adm`,
    `${botPrefix}meme [tema] - busca meme na internet e envia no grupo`,
    `${botPrefix}musica nome - busca música na internet e manda prévia/link`,
    `${botPrefix}figurinha / ${botPrefix}fig / ${botPrefix}sticker - cria figurinha da mídia enviada ou respondida`,
    `${botPrefix}foto / ${botPrefix}perfil / ${botPrefix}pfp @membro - baixa a foto de perfil`,
    `${botPrefix}censurar - apaga a mensagem respondida`,
    `${botPrefix}banir / ${botPrefix}ban @membro - remove membro por menção, resposta ou número`,
    `${botPrefix}grupo fechar / ${botPrefix}fechargrupo - só administradores podem falar`,
    `${botPrefix}grupo abrir / ${botPrefix}abrirgrupo - libera mensagens para todos`,
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

    if (comandoNormalizado === 'pix') {
      await message.reply('💸 Ajude os adm e pague o piraque\n\nChaves Pix:\n21971656061\n22997635869');
      return;
    }

    if (comandoPartes[0]?.toLowerCase() === 'meme') {
      await sendMemeFromInternet(chat, message, buildCommandQuery(comandoPartes));
      return;
    }

    if (comandoPartes[0]?.toLowerCase() === 'musica' || comandoPartes[0]?.toLowerCase() === 'música') {
      await sendMusicFromInternet(chat, message, buildCommandQuery(comandoPartes));
      return;
    }

    if (comandoNormalizado === 'figurinha' || comandoNormalizado === 'sticker' || comandoNormalizado === 'fig') {
      const sourceMessage = await resolveStickerSourceMessage(message);
      if (!sourceMessage) {
        await message.reply(`❌ Envie ${botPrefix}figurinha na legenda de uma imagem/vídeo ou responda uma mídia com esse comando.`);
        return;
      }

      try {
        const media = await sourceMessage.downloadMedia();

        if (!media) {
          await message.reply('❌ Não consegui baixar essa mídia para transformar em figurinha.');
          return;
        }

        if (!isStickerCompatibleMedia(media)) {
          await message.reply('❌ Só consigo criar figurinha a partir de imagem ou vídeo.');
          return;
        }

        await chat.sendMessage(media, {
          sendMediaAsSticker: true,
          quotedMessageId: message.id._serialized
        });
      } catch (erroAoCriarFigurinha) {
        console.error('Erro ao criar figurinha:', erroAoCriarFigurinha.message);
        await message.reply('❌ Não consegui criar a figurinha. Se for vídeo, confirme que o ffmpeg está disponível no ambiente.');
      }

      return;
    }

    if (comandoPartes[0]?.toLowerCase() === 'foto' || comandoPartes[0]?.toLowerCase() === 'perfil' || comandoPartes[0]?.toLowerCase() === 'pfp') {
      const alvoId = await resolveCommandTargetId(chat, message, comandoPartes);
      if (!alvoId) {
        await message.reply(`❌ Marque, responda ou informe o número de quem você quer baixar a foto. Ex.: ${botPrefix}foto @usuario`);
        return;
      }

      try {
        const fotoPerfil = await resolveProfilePhotoMedia(alvoId);

        if (!fotoPerfil?.media) {
          await message.reply('❌ Não consegui acessar a foto de perfil desse contato. A privacidade dele pode estar bloqueando.');
          return;
        }

        await chat.sendMessage(fotoPerfil.media, {
          caption: `📸 Foto de perfil de @${alvoId.split('@')[0]}`,
          mentions: [alvoId],
          sendMediaAsHd: true,
          quotedMessageId: message.id._serialized
        });
      } catch (erroAoBaixarFoto) {
        console.error('Erro ao baixar foto de perfil:', erroAoBaixarFoto);
        await message.reply('❌ Não consegui baixar essa foto de perfil agora.');
      }

      return;
    }

    if (
      comandoNormalizado === 'grupo fechar' ||
      comandoNormalizado === 'fechargrupo'
    ) {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem fechar o grupo.');
        return;
      }

      const botId = client.info?.wid?._serialized || '';
      if (!botId || !(await isSenderAdmin(chat, botId))) {
        await message.reply('❌ Preciso ser administrador do grupo para fechar o envio de mensagens.');
        return;
      }

      if (typeof chat.setMessagesAdminsOnly !== 'function') {
        await message.reply('❌ Este grupo não permite alterar quem pode enviar mensagens por este cliente.');
        return;
      }

      try {
        const success = await chat.setMessagesAdminsOnly(true);

        if (!success) {
          await message.reply('❌ Não consegui fechar o grupo.');
          return;
        }

        await message.reply('🔒 Grupo fechado. Agora só administradores podem enviar mensagens.');
      } catch (erroAoFecharGrupo) {
        console.error('Erro ao fechar grupo:', erroAoFecharGrupo.message);
        await message.reply('❌ Não consegui fechar o grupo. Verifique se eu ainda sou admin.');
      }

      return;
    }

    if (
      comandoNormalizado === 'grupo abrir' ||
      comandoNormalizado === 'abrirgrupo'
    ) {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem abrir o grupo.');
        return;
      }

      const botId = client.info?.wid?._serialized || '';
      if (!botId || !(await isSenderAdmin(chat, botId))) {
        await message.reply('❌ Preciso ser administrador do grupo para liberar o envio de mensagens.');
        return;
      }

      if (typeof chat.setMessagesAdminsOnly !== 'function') {
        await message.reply('❌ Este grupo não permite alterar quem pode enviar mensagens por este cliente.');
        return;
      }

      try {
        const success = await chat.setMessagesAdminsOnly(false);

        if (!success) {
          await message.reply('❌ Não consegui abrir o grupo.');
          return;
        }

        await message.reply('🔓 Grupo aberto. Agora todos podem enviar mensagens.');
      } catch (erroAoAbrirGrupo) {
        console.error('Erro ao abrir grupo:', erroAoAbrirGrupo.message);
        await message.reply('❌ Não consegui abrir o grupo. Verifique se eu ainda sou admin.');
      }

      return;
    }

    if (comandoNormalizado === 'censurar' || comandoNormalizado === 'apagar' || comandoNormalizado === 'del') {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem apagar mensagens.');
        return;
      }

      const botId = client.info?.wid?._serialized || '';
      if (!botId || !(await isSenderAdmin(chat, botId))) {
        await message.reply('❌ Preciso ser administrador do grupo para apagar mensagens.');
        return;
      }

      if (!message.hasQuotedMsg) {
        await message.reply(`❌ Responda a mensagem que você quer apagar com ${botPrefix}censurar.`);
        return;
      }

      try {
        const quotedMessage = await message.getQuotedMessage();

        if (!quotedMessage) {
          await message.reply('❌ Não consegui localizar a mensagem selecionada.');
          return;
        }

        await quotedMessage.delete(true);

        try {
          await message.delete(true);
        } catch (erroAoApagarComando) {
          console.error('Não foi possível apagar o comando de apagar:', erroAoApagarComando.message);
        }
      } catch (erroAoApagarMensagem) {
        console.error('Erro ao apagar mensagem selecionada:', erroAoApagarMensagem.message);
        await message.reply('❌ Não consegui apagar essa mensagem. Verifique se eu ainda sou admin e se a mensagem ainda existe.');
      }

      return;
    }

    if (comandoPartes[0]?.toLowerCase() === 'banir' || comandoPartes[0]?.toLowerCase() === 'ban') {
      if (!remetenteAdmin) {
        await message.reply('❌ Apenas administradores podem banir membros.');
        return;
      }

      const botId = client.info?.wid?._serialized || '';
      if (!botId || !(await isSenderAdmin(chat, botId))) {
        await message.reply('❌ Preciso ser administrador do grupo para conseguir banir alguém.');
        return;
      }

      const alvoId = await resolveCommandTargetId(chat, message, comandoPartes);
      if (!alvoId) {
        await message.reply(`❌ Marque, responda ou informe o número de quem deve ser removido. Ex.: ${botPrefix}banir @usuario`);
        return;
      }

      if (isSameWhatsAppUser(alvoId, remetenteId)) {
        await message.reply('❌ Você não pode banir a si mesmo.');
        return;
      }

      if (botId && isSameWhatsAppUser(alvoId, botId)) {
        await message.reply('❌ Não vou me banir do grupo.');
        return;
      }

      if (await isSenderAdmin(chat, alvoId)) {
        await message.reply('❌ Não vou remover outro administrador.');
        return;
      }

      if (typeof chat.removeParticipants !== 'function') {
        await message.reply('❌ Este grupo não permite banimento por este cliente.');
        return;
      }

      try {
        const resultado = await chat.removeParticipants([alvoId]);

        if (resultado?.status !== 200) {
          await message.reply('❌ Não consegui concluir o banimento.');
          return;
        }

        clearSpamTrackerForUser(chat.id._serialized, alvoId);
        await chat.sendMessage(`🚫 @${alvoId.split('@')[0]} foi removido(a) do grupo.`, {
          mentions: [alvoId]
        });
      } catch (erroAoBanir) {
        console.error('Erro ao banir participante:', erroAoBanir.message);
        await message.reply('❌ Não consegui banir esse membro. Verifique se eu ainda sou admin e se a pessoa está no grupo.');
      }

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
