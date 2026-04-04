require('dotenv').config();

module.exports = {
  botPrefix: process.env.BOT_PREFIX || '!',
  blockLinks: String(process.env.BLOCK_LINKS || 'true') === 'true',
  ignoreAdmins: String(process.env.IGNORE_ADMINS || 'true') === 'true',
  welcomeNewMembers: String(process.env.WELCOME_NEW_MEMBERS || 'true') === 'true',
  leaveMessageForBlockedLink: String(process.env.LEAVE_MESSAGE_FOR_BLOCKED_LINK || 'true') === 'true',
  antiSpamEnabled: String(process.env.ANTI_SPAM_ENABLED || 'true') === 'true',
  antiSpamMaxMessages: Number.parseInt(process.env.ANTI_SPAM_MAX_MESSAGES || '5', 10),
  antiSpamWindowMs: Number.parseInt(process.env.ANTI_SPAM_WINDOW_MS || '10000', 10),
  antiSpamDeleteMessage: String(process.env.ANTI_SPAM_DELETE_MESSAGE || 'true') === 'true',
  antiSpamWarnUser: String(process.env.ANTI_SPAM_WARN_USER || 'true') === 'true',
  pairingPhoneNumber: String(process.env.PAIR_WITH_PHONE_NUMBER || '').replace(/\D/g, ''),
  pairingShowNotification: String(process.env.PAIRING_SHOW_NOTIFICATION || 'true') === 'true',
  pairingIntervalMs: Number.parseInt(process.env.PAIRING_INTERVAL_MS || '180000', 10),
  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
  puppeteerHeadless: process.env.PUPPETEER_HEADLESS || 'true',
  tenorApiKey: 'LIVDSRZULELA'
};
