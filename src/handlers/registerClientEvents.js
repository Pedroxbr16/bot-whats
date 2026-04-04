const qrcode = require('qrcode-terminal');
const { createGroupMessageHandler } = require('./createMessageHandler');

function registerClientEvents({ client, config, runtimeState, groupService, internetService }) {
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

  client.on('group_join', async (notification) => {
    if (!config.welcomeNewMembers) return;

    try {
      const chat = await notification.getChat();
      const addedContacts = notification.recipientIds || [];

      for (const contactId of addedContacts) {
        await chat.sendMessage(
          `👋 Seja bem-vindo(a), @${contactId.split('@')[0]}! Leia as regras do grupo e fique à vontade.`,
          {
            mentions: [contactId]
          }
        );
      }
    } catch (error) {
      console.error('Erro ao dar boas-vindas:', error.message);
    }
  });

  client.on('message', createGroupMessageHandler({
    client,
    config,
    runtimeState,
    groupService,
    internetService
  }));
}

module.exports = {
  registerClientEvents
};
