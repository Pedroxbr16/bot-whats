const { isSameWhatsAppUser } = require('../utils/common');

function createGroupService() {
  async function isParticipantAdmin(chat, authorId) {
    if (!chat?.isGroup || !authorId) return false;

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
    isParticipantAdmin
  };
}

module.exports = {
  createGroupService
};
