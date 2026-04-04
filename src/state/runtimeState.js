const { isSameWhatsAppUser, parsePositiveInteger } = require('../utils/common');

function createRuntimeState(config) {
  return {
    blockLinksEnabled: config.blockLinks,
    antiSpamEnabled: config.antiSpamEnabled,
    antiSpamMaxMessages: parsePositiveInteger(config.antiSpamMaxMessages, 5),
    antiSpamWindowMs: parsePositiveInteger(config.antiSpamWindowMs, 10000),
    processedMessages: new Set(),
    spamTracker: new Map()
  };
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

function clearSpamTrackerForUser(spamTracker, chatId, participantId) {
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

module.exports = {
  buildSpamStatusMessage,
  clearSpamTrackerForUser,
  createRuntimeState,
  getSpamTrackerKey,
  isSpamMessage
};
