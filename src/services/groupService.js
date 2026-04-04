const { MessageMedia } = require('whatsapp-web.js');
const { extractDigits, isSameWhatsAppUser } = require('../utils/common');

function getSerializedParticipantId(participant) {
  return participant?.id?._serialized || '';
}

function createGroupService(client) {
  async function resolveParticipantIdInGroup(chat, candidateId) {
    if (!chat?.isGroup || !candidateId) return '';

    const participants = chat.participants || [];
    const foundParticipant = participants.find((participant) => {
      return isSameWhatsAppUser(getSerializedParticipantId(participant), candidateId);
    });

    if (foundParticipant) {
      return getSerializedParticipantId(foundParticipant);
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
    } catch (error) {
      console.error('Erro ao localizar participante do grupo:', error.message);
      return '';
    }
  }

  async function resolveTargetParticipantId(chat, message, commandParts) {
    const candidateIds = [];
    const argument = commandParts.slice(1).join(' ').trim();
    const normalizedArgument = argument.toLowerCase();
    const senderId = message?.author || message?.from || '';

    if (['eu', 'me', 'meu', 'minha', 'mia'].includes(normalizedArgument) && senderId) {
      return senderId;
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
      } catch (error) {
        console.error('Erro ao obter a mensagem respondida para banimento:', error.message);
      }
    }

    if (argument) {
      const digits = extractDigits(argument);

      if (digits) {
        candidateIds.push(`${digits}@c.us`, digits);
      } else {
        candidateIds.push(argument);
      }
    }

    for (const candidateId of candidateIds) {
      const participantId = await resolveParticipantIdInGroup(chat, candidateId);
      if (participantId) return participantId;
    }

    return '';
  }

  function buildProfilePhotoLookupCandidates(targetId) {
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

  async function getProfilePhotoUrlsFromStore(lookupId) {
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
    } catch (error) {
      console.error(`Erro ao listar URLs da foto de perfil para ${lookupId}:`, error.message);
      return [];
    }
  }

  async function getProfilePhotoThumbnailMedia(lookupId) {
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
    } catch (error) {
      console.error(`Erro ao buscar thumb da foto de perfil para ${lookupId}:`, error.message);
      return null;
    }
  }

  async function downloadProfilePhotoFromUrl(photoUrl, lookupId) {
    if (!photoUrl) return null;

    const filename = `foto-perfil-${extractDigits(lookupId) || 'contato'}.jpg`;

    try {
      // Tenta baixar no contexto do navegador para reaproveitar a sessão autenticada.
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
    } catch (error) {
      console.error(`Erro ao baixar foto de perfil no navegador para ${lookupId}:`, error.message);
    }

    try {
      return await MessageMedia.fromUrl(photoUrl, {
        unsafeMime: true,
        filename
      });
    } catch (error) {
      console.error(`Erro ao baixar foto de perfil no Node para ${lookupId}:`, error.message);
      return null;
    }
  }

  async function resolveProfilePhotoForParticipant(targetId) {
    const lookupIds = buildProfilePhotoLookupCandidates(targetId);

    for (const lookupId of lookupIds) {
      try {
        const candidateUrls = await getProfilePhotoUrlsFromStore(lookupId);
        for (const candidateUrl of candidateUrls) {
          const profilePhoto = await downloadProfilePhotoFromUrl(candidateUrl, lookupId);
          if (!profilePhoto) continue;

          return {
            media: profilePhoto,
            resolvedId: lookupId
          };
        }

        const thumbMedia = await getProfilePhotoThumbnailMedia(lookupId);
        if (thumbMedia) {
          return {
            media: thumbMedia,
            resolvedId: lookupId
          };
        }
      } catch (error) {
        console.error(`Erro ao buscar foto de perfil para ${lookupId}:`, error.message);
      }
    }

    return null;
  }

  async function isParticipantAdmin(chat, authorId) {
    if (!chat.isGroup || !authorId) return false;

    try {
      const isAdminFromBrowser = await chat.client.pupPage.evaluate(async (chatId, participantId) => {
        const chatModel = await window.WWebJS.getChat(chatId, { getAsModel: false });
        if (!chatModel?.groupMetadata?.participants) return false;

        const { lid, phone } = await window.WWebJS.enforceLidAndPnRetrieval(participantId);
        const participant =
          chatModel.groupMetadata.participants.get(lid?._serialized) ||
          chatModel.groupMetadata.participants.get(phone?._serialized);

        return Boolean(participant?.isAdmin || participant?.isSuperAdmin);
      }, chat.id._serialized, authorId);

      if (isAdminFromBrowser) return true;

      const participants = chat.participants || [];
      const foundParticipant = participants.find((participant) => {
        const participantId = participant?.id?._serialized;
        return isSameWhatsAppUser(participantId, authorId);
      });

      if (!foundParticipant) return false;

      return foundParticipant.isAdmin || foundParticipant.isSuperAdmin || false;
    } catch (error) {
      console.error('Erro ao verificar admin:', error.message);
      return false;
    }
  }

  return {
    isParticipantAdmin,
    resolveProfilePhotoForParticipant,
    resolveTargetParticipantId
  };
}

module.exports = {
  createGroupService
};
