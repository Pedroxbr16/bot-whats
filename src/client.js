const fs = require('fs');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

function createClient(config) {
  const sessionPath = path.resolve('.session');

  if (!fs.existsSync(sessionPath)) {
    fs.mkdirSync(sessionPath, { recursive: true });
  }

  return new Client({
    authStrategy: new LocalAuth({
      dataPath: sessionPath,
      clientId: 'bot-grupo'
    }),
    ...(config.pairingPhoneNumber ? {
      pairWithPhoneNumber: {
        phoneNumber: config.pairingPhoneNumber,
        showNotification: config.pairingShowNotification,
        intervalMs: Number.isFinite(config.pairingIntervalMs) && config.pairingIntervalMs > 0
          ? config.pairingIntervalMs
          : 180000
      }
    } : {}),
    puppeteer: {
      headless: config.puppeteerHeadless === 'true' ? true : config.puppeteerHeadless,
      ...(config.puppeteerExecutablePath ? { executablePath: config.puppeteerExecutablePath } : {}),
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
  });
}

module.exports = {
  createClient
};
