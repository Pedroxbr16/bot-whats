const { isSameWhatsAppUser, parsePositiveInteger } = require('../utils/common');

function createBotRuntimeState(config) {
  return {
    blockLinksEnabled: config.blockLinks,
    antiSpamEnabled: config.antiSpamEnabled,
    antiSpamMaxMessages: parsePositiveInteger(config.antiSpamMaxMessages, 5),
    antiSpamWindowMs: parsePositiveInteger(config.antiSpamWindowMs, 10000),
    processedMessages: new Set(),
    spamTracker: new Map()
  };
}

function buildSpamTrackerKey(chatId, senderId) {
  if (!chatId || !senderId) return '';
  return `${chatId}:${senderId}`;
}

function evaluateSpamBurst(history, now, maxMessages, windowMs) {
  const validWindowMs = parsePositiveInteger(windowMs, 10000);
  const validMaxMessages = parsePositiveInteger(maxMessages, 5);
  const recentMessages = history.filter((timestamp) => now - timestamp <= validWindowMs);

  return {
    recentMessages,
    exceeded: recentMessages.length >= validMaxMessages
  };
}

function buildAntiSpamStatusMessage(isEnabled, maxMessages, windowMs) {
  return `🤖 Anti-spam: ${isEnabled ? 'ativado' : 'desativado'} | limite: ${maxMessages} mensagem(ns) em ${Math.floor(windowMs / 1000)} segundo(s).`;
}

function clearTrackedSpamForParticipant(spamTracker, chatId, participantId) {
  if (!chatId || !participantId) return;

  const keyPrefix = `${chatId}:`;

  for (const spamKey of spamTracker.keys()) {
    if (!spamKey.startsWith(keyPrefix)) continue;

    const senderId = spamKey.slice(keyPrefix.length);
    // O mesmo usuário pode chegar como telefone ou LID dependendo do contexto.
    if (isSameWhatsAppUser(senderId, participantId)) {
      spamTracker.delete(spamKey);
    }
  }
}

module.exports = {
  buildAntiSpamStatusMessage,
  buildSpamTrackerKey,
  clearTrackedSpamForParticipant,
  createBotRuntimeState,
  evaluateSpamBurst
};
