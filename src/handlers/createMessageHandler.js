const {
  getSerializedMessageId,
  textContainsLink
} = require('../utils/common');

function createGroupMessageHandler({ config, runtimeState, groupService }) {
  function rememberProcessedMessage(serializedMessageId) {
    if (!serializedMessageId) return false;
    if (runtimeState.processedMessages.has(serializedMessageId)) return true;

    runtimeState.processedMessages.add(serializedMessageId);

    setTimeout(() => {
      runtimeState.processedMessages.delete(serializedMessageId);
    }, 5 * 60 * 1000);

    return false;
  }

  async function applyBlockedLinksPolicy({ chat, message, messageText, senderId, senderIsAdmin }) {
    if (!runtimeState.blockLinksEnabled) return false;
    if (!textContainsLink(messageText)) return false;
    if (config.ignoreAdmins && senderIsAdmin) return false;

    try {
      await message.delete(true);
    } catch (deleteError) {
      console.error('Nao foi possivel apagar a mensagem com link:', deleteError.message);
    }

    if (config.leaveMessageForBlockedLink) {
      await chat.sendMessage(`🚫 @${senderId.split('@')[0]}, links nao sao permitidos neste grupo.`, {
        mentions: [senderId]
      });
    }

    return true;
  }

  async function applyAntiSpamPolicy({ chat, message, messageText, senderId, senderIsAdmin }) {
    if (!runtimeState.antiSpamEnabled) return false;
    if (!messageText) return false;
    if (config.ignoreAdmins && senderIsAdmin) return false;

    const chatId = chat.id?._serialized || '';
    const maxMessagesInSequence = runtimeState.antiSpamMaxMessages || 5;
    const currentSequence = runtimeState.spamTracker.get(chatId) || {
      senderId: '',
      count: 0
    };

    const nextSequence = {
      senderId,
      count: currentSequence.senderId === senderId ? currentSequence.count + 1 : 1
    };

    runtimeState.spamTracker.set(chatId, nextSequence);

    if (nextSequence.count < maxMessagesInSequence) return false;

    if (config.antiSpamDeleteMessage) {
      try {
        await message.delete(true);
      } catch (deleteError) {
        console.error('Nao foi possivel apagar a mensagem por spam:', deleteError.message);
      }
    }

    if (config.antiSpamWarnUser) {
      await chat.sendMessage(`🚫 @${senderId.split('@')[0]}, pare com o spam.`, {
        mentions: [senderId]
      });
    }

    return true;
  }

  return async function handleGroupMessage(message) {
    try {
      const serializedMessageId = getSerializedMessageId(message);
      if (rememberProcessedMessage(serializedMessageId)) return;

      if (message.fromMe) return;

      const chat = await message.getChat();
      if (!chat.isGroup) return;

      const messageText = (message.body || '').trim();
      const senderId = message.author || message.from;
      const senderIsAdmin = await groupService.isParticipantAdmin(chat, senderId);

      const blockedByLinksPolicy = await applyBlockedLinksPolicy({
        chat,
        message,
        messageText,
        senderId,
        senderIsAdmin
      });
      if (blockedByLinksPolicy) return;

      await applyAntiSpamPolicy({
        chat,
        message,
        messageText,
        senderId,
        senderIsAdmin
      });
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  };
}

module.exports = {
  createGroupMessageHandler
};
