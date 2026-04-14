const qrcode = require('qrcode-terminal');
const { createGroupMessageHandler } = require('./createMessageHandler');

function registerClientEvents({ client, config, runtimeState, groupService }) {
  client.on('qr', (qr) => {
    console.log('Escaneie o QR Code abaixo com o WhatsApp:');
    qrcode.generate(qr, { small: true });
  });

  client.on('code', (code) => {
    console.log(`Codigo de pareamento: ${code}`);
  });

  client.on('loading_screen', (progress, message) => {
    console.log(`Carregando: ${progress}% - ${message}`);
  });

  client.on('authenticated', () => {
    console.log('Autenticado com sucesso.');
  });

  client.on('ready', () => {
    console.log('Bot conectado e pronto para uso.');
  });

  client.on('auth_failure', (message) => {
    console.error('Falha na autenticação:', message);
  });

  client.on('disconnected', (reason) => {
    console.log('Bot desconectado:', reason);
  });

  client.on('message', createGroupMessageHandler({
    config,
    runtimeState,
    groupService
  }));
}

module.exports = {
  registerClientEvents
};
