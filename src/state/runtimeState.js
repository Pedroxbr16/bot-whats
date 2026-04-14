function createBotRuntimeState(config) {
  return {
    blockLinksEnabled: config.blockLinks,
    antiSpamEnabled: config.antiSpamEnabled,
    antiSpamMaxMessages: 5,
    processedMessages: new Set(),
    spamTracker: new Map()
  };
}

module.exports = {
  createBotRuntimeState
};
