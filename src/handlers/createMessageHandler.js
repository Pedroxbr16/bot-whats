const { buildHelpMessage } = require('../messages/helpMessage');
const { isStickerCompatibleMedia, resolveStickerSourceMessage } = require('../services/stickerService');
const {
  buildSpamStatusMessage,
  clearSpamTrackerForUser,
  getSpamTrackerKey,
  isSpamMessage
} = require('../state/runtimeState');
const {
  buildCommandQuery,
  containsLink,
  getMessageUniqueId,
  isSameWhatsAppUser,
  parsePositiveInteger
} = require('../utils/common');

function createMessageHandler({ client, config, runtimeState, groupService, internetService }) {
  return async function handleMessage(message) {
    try {
      const messageUniqueId = getMessageUniqueId(message);
      if (messageUniqueId && runtimeState.processedMessages.has(messageUniqueId)) return;

      if (messageUniqueId) {
        runtimeState.processedMessages.add(messageUniqueId);

        setTimeout(() => {
          runtimeState.processedMessages.delete(messageUniqueId);
        }, 5 * 60 * 1000);
      }

      if (message.fromMe) return;

      const chat = await message.getChat();
      if (!chat.isGroup) return;

      const text = (message.body || '').trim();
      const senderId = message.author || message.from;
      const senderIsAdmin = await groupService.isSenderAdmin(chat, senderId);

      if (runtimeState.blockLinksEnabled && containsLink(text)) {
        if (!(config.ignoreAdmins && senderIsAdmin)) {
          try {
            await message.delete(true);
          } catch (deleteError) {
            console.error('Não foi possível apagar a mensagem com link:', deleteError.message);
          }

          if (config.leaveMessageForBlockedLink) {
            await chat.sendMessage(`🚫 @${senderId.split('@')[0]}, links não são permitidos neste grupo.`, {
              mentions: [senderId]
            });
          }

          return;
        }
      }

      if (runtimeState.antiSpamEnabled && text) {
        const shouldIgnoreSpamRule = config.ignoreAdmins && senderIsAdmin;

        if (!shouldIgnoreSpamRule) {
          const spamTrackerKey = getSpamTrackerKey(chat.id._serialized, senderId);
          const now = Date.now();
          const messageHistory = runtimeState.spamTracker.get(spamTrackerKey) || [];
          const { recentMessages, exceeded } = isSpamMessage(
            messageHistory,
            now,
            runtimeState.antiSpamMaxMessages,
            runtimeState.antiSpamWindowMs
          );

          recentMessages.push(now);
          runtimeState.spamTracker.set(spamTrackerKey, recentMessages);

          const cleanupDelayMs = runtimeState.antiSpamWindowMs;
          setTimeout(() => {
            const currentHistory = runtimeState.spamTracker.get(spamTrackerKey) || [];
            const freshHistory = currentHistory.filter((timestamp) => {
              return Date.now() - timestamp <= runtimeState.antiSpamWindowMs;
            });

            if (freshHistory.length > 0) {
              runtimeState.spamTracker.set(spamTrackerKey, freshHistory);
              return;
            }

            runtimeState.spamTracker.delete(spamTrackerKey);
          }, cleanupDelayMs);

          if (exceeded) {
            if (config.antiSpamDeleteMessage) {
              try {
                await message.delete(true);
              } catch (deleteError) {
                console.error('Não foi possível apagar a mensagem por spam:', deleteError.message);
              }
            }

            if (config.antiSpamWarnUser) {
              await chat.sendMessage(`🚫 @${senderId.split('@')[0]}, pare com o spam.`, {
                mentions: [senderId]
              });
            }

            return;
          }
        }
      }

      if (!text.startsWith(config.botPrefix)) return;

      const fullCommand = text.slice(config.botPrefix.length).trim();
      const normalizedCommand = fullCommand.toLowerCase();
      const commandParts = fullCommand.split(/\s+/).filter(Boolean);
      const commandName = commandParts[0]?.toLowerCase();

      if (normalizedCommand === 'ping') {
        await message.reply('🏓 Pong! Estou online.');
        return;
      }

      if (normalizedCommand === 'menu' || normalizedCommand === 'ajuda' || normalizedCommand === 'help') {
        await message.reply(buildHelpMessage(config.botPrefix));
        return;
      }

      if (normalizedCommand === 'id') {
        await message.reply(`🆔 ID do grupo: ${chat.id._serialized}`);
        return;
      }

      if (normalizedCommand === 'pix') {
        await message.reply('💸 Ajude os adm e pague o piraque\n\nChaves Pix:\n21971656061\n22997635869');
        return;
      }

      if (commandName === 'meme') {
        await internetService.sendMemeFromInternet(chat, message, buildCommandQuery(commandParts));
        return;
      }

      if (commandName === 'musica' || commandName === 'música') {
        await internetService.sendMusicFromInternet(chat, message, buildCommandQuery(commandParts));
        return;
      }

      if (normalizedCommand === 'figurinha' || normalizedCommand === 'sticker' || normalizedCommand === 'fig') {
        const sourceMessage = await resolveStickerSourceMessage(message);
        if (!sourceMessage) {
          await message.reply(`❌ Envie ${config.botPrefix}figurinha na legenda de uma imagem/vídeo ou responda uma mídia com esse comando.`);
          return;
        }

        try {
          const media = await sourceMessage.downloadMedia();

          if (!media) {
            await message.reply('❌ Não consegui baixar essa mídia para transformar em figurinha.');
            return;
          }

          if (!isStickerCompatibleMedia(media)) {
            await message.reply('❌ Só consigo criar figurinha a partir de imagem ou vídeo.');
            return;
          }

          await chat.sendMessage(media, {
            sendMediaAsSticker: true,
            quotedMessageId: message.id._serialized
          });
        } catch (stickerError) {
          console.error('Erro ao criar figurinha:', stickerError.message);
          await message.reply('❌ Não consegui criar a figurinha. Se for vídeo, confirme que o ffmpeg está disponível no ambiente.');
        }

        return;
      }

      if (commandName === 'foto' || commandName === 'perfil' || commandName === 'pfp') {
        const targetId = await groupService.resolveCommandTargetId(chat, message, commandParts);
        if (!targetId) {
          await message.reply(`❌ Marque, responda ou informe o número de quem você quer baixar a foto. Ex.: ${config.botPrefix}foto @usuario`);
          return;
        }

        try {
          const profilePhoto = await groupService.resolveProfilePhotoMedia(targetId);

          if (!profilePhoto?.media) {
            await message.reply('❌ Não consegui acessar a foto de perfil desse contato. A privacidade dele pode estar bloqueando.');
            return;
          }

          await chat.sendMessage(profilePhoto.media, {
            caption: `📸 Foto de perfil de @${targetId.split('@')[0]}`,
            mentions: [targetId],
            sendMediaAsHd: true,
            quotedMessageId: message.id._serialized
          });
        } catch (profilePhotoError) {
          console.error('Erro ao baixar foto de perfil:', profilePhotoError);
          await message.reply('❌ Não consegui baixar essa foto de perfil agora.');
        }

        return;
      }

      if (normalizedCommand === 'grupo fechar' || normalizedCommand === 'fechargrupo') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem fechar o grupo.');
          return;
        }

        const botId = client.info?.wid?._serialized || '';
        if (!botId || !(await groupService.isSenderAdmin(chat, botId))) {
          await message.reply('❌ Preciso ser administrador do grupo para fechar o envio de mensagens.');
          return;
        }

        if (typeof chat.setMessagesAdminsOnly !== 'function') {
          await message.reply('❌ Este grupo não permite alterar quem pode enviar mensagens por este cliente.');
          return;
        }

        try {
          const success = await chat.setMessagesAdminsOnly(true);

          if (!success) {
            await message.reply('❌ Não consegui fechar o grupo.');
            return;
          }

          await message.reply('🔒 Grupo fechado. Agora só administradores podem enviar mensagens.');
        } catch (closeGroupError) {
          console.error('Erro ao fechar grupo:', closeGroupError.message);
          await message.reply('❌ Não consegui fechar o grupo. Verifique se eu ainda sou admin.');
        }

        return;
      }

      if (normalizedCommand === 'grupo abrir' || normalizedCommand === 'abrirgrupo') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem abrir o grupo.');
          return;
        }

        const botId = client.info?.wid?._serialized || '';
        if (!botId || !(await groupService.isSenderAdmin(chat, botId))) {
          await message.reply('❌ Preciso ser administrador do grupo para liberar o envio de mensagens.');
          return;
        }

        if (typeof chat.setMessagesAdminsOnly !== 'function') {
          await message.reply('❌ Este grupo não permite alterar quem pode enviar mensagens por este cliente.');
          return;
        }

        try {
          const success = await chat.setMessagesAdminsOnly(false);

          if (!success) {
            await message.reply('❌ Não consegui abrir o grupo.');
            return;
          }

          await message.reply('🔓 Grupo aberto. Agora todos podem enviar mensagens.');
        } catch (openGroupError) {
          console.error('Erro ao abrir grupo:', openGroupError.message);
          await message.reply('❌ Não consegui abrir o grupo. Verifique se eu ainda sou admin.');
        }

        return;
      }

      if (commandName === 'daradm' || commandName === 'promover') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem dar admin.');
          return;
        }

        const botId = client.info?.wid?._serialized || '';
        if (!botId || !(await groupService.isSenderAdmin(chat, botId))) {
          await message.reply('❌ Preciso ser administrador do grupo para promover alguém.');
          return;
        }

        const targetId = await groupService.resolveCommandTargetId(chat, message, commandParts);
        if (!targetId) {
          await message.reply(`❌ Marque, responda ou informe o número de quem deve virar admin. Ex.: ${config.botPrefix}daradm @usuario`);
          return;
        }

        if (isSameWhatsAppUser(targetId, botId)) {
          await message.reply('❌ Eu já sou admin.');
          return;
        }

        if (await groupService.isSenderAdmin(chat, targetId)) {
          await message.reply('❌ Esse membro já é administrador.');
          return;
        }

        if (typeof chat.promoteParticipants !== 'function') {
          await message.reply('❌ Este grupo não permite promover participantes por este cliente.');
          return;
        }

        try {
          const result = await chat.promoteParticipants([targetId]);

          if (result?.status !== 200) {
            await message.reply('❌ Não consegui promover esse membro.');
            return;
          }

          await chat.sendMessage(`👑 @${targetId.split('@')[0]} agora é administrador(a).`, {
            mentions: [targetId]
          });
        } catch (promoteError) {
          console.error('Erro ao promover participante:', promoteError.message);
          await message.reply('❌ Não consegui dar admin para esse membro.');
        }

        return;
      }

      if (commandName === 'tiraradm' || commandName === 'rebaixar') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem tirar admin.');
          return;
        }

        const botId = client.info?.wid?._serialized || '';
        if (!botId || !(await groupService.isSenderAdmin(chat, botId))) {
          await message.reply('❌ Preciso ser administrador do grupo para remover admin de alguém.');
          return;
        }

        const targetId = await groupService.resolveCommandTargetId(chat, message, commandParts);
        if (!targetId) {
          await message.reply(`❌ Marque, responda ou informe o número de quem deve perder o cargo. Ex.: ${config.botPrefix}tiraradm @usuario`);
          return;
        }

        if (isSameWhatsAppUser(targetId, senderId)) {
          await message.reply('❌ Você não pode remover seu próprio cargo por aqui.');
          return;
        }

        if (botId && isSameWhatsAppUser(targetId, botId)) {
          await message.reply('❌ Não vou remover meu próprio cargo de admin.');
          return;
        }

        if (!(await groupService.isSenderAdmin(chat, targetId))) {
          await message.reply('❌ Esse membro não é administrador.');
          return;
        }

        if (typeof chat.demoteParticipants !== 'function') {
          await message.reply('❌ Este grupo não permite rebaixar participantes por este cliente.');
          return;
        }

        try {
          const result = await chat.demoteParticipants([targetId]);

          if (result?.status !== 200) {
            await message.reply('❌ Não consegui remover o cargo desse admin.');
            return;
          }

          await chat.sendMessage(`⬇️ @${targetId.split('@')[0]} não é mais administrador(a).`, {
            mentions: [targetId]
          });
        } catch (demoteError) {
          console.error('Erro ao rebaixar participante:', demoteError.message);
          await message.reply('❌ Não consegui tirar o admin desse membro.');
        }

        return;
      }

      if (normalizedCommand === 'censurar' || normalizedCommand === 'apagar' || normalizedCommand === 'del') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem apagar mensagens.');
          return;
        }

        const botId = client.info?.wid?._serialized || '';
        if (!botId || !(await groupService.isSenderAdmin(chat, botId))) {
          await message.reply('❌ Preciso ser administrador do grupo para apagar mensagens.');
          return;
        }

        if (!message.hasQuotedMsg) {
          await message.reply(`❌ Responda a mensagem que você quer apagar com ${config.botPrefix}censurar.`);
          return;
        }

        try {
          const quotedMessage = await message.getQuotedMessage();

          if (!quotedMessage) {
            await message.reply('❌ Não consegui localizar a mensagem selecionada.');
            return;
          }

          await quotedMessage.delete(true);

          try {
            await message.delete(true);
          } catch (deleteCommandError) {
            console.error('Não foi possível apagar o comando de apagar:', deleteCommandError.message);
          }
        } catch (deleteMessageError) {
          console.error('Erro ao apagar mensagem selecionada:', deleteMessageError.message);
          await message.reply('❌ Não consegui apagar essa mensagem. Verifique se eu ainda sou admin e se a mensagem ainda existe.');
        }

        return;
      }

      if (commandName === 'banir' || commandName === 'ban') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem banir membros.');
          return;
        }

        const botId = client.info?.wid?._serialized || '';
        if (!botId || !(await groupService.isSenderAdmin(chat, botId))) {
          await message.reply('❌ Preciso ser administrador do grupo para conseguir banir alguém.');
          return;
        }

        const targetId = await groupService.resolveCommandTargetId(chat, message, commandParts);
        if (!targetId) {
          await message.reply(`❌ Marque, responda ou informe o número de quem deve ser removido. Ex.: ${config.botPrefix}banir @usuario`);
          return;
        }

        if (isSameWhatsAppUser(targetId, senderId)) {
          await message.reply('❌ Você não pode banir a si mesmo.');
          return;
        }

        if (botId && isSameWhatsAppUser(targetId, botId)) {
          await message.reply('❌ Não vou me banir do grupo.');
          return;
        }

        if (await groupService.isSenderAdmin(chat, targetId)) {
          await message.reply('❌ Não vou remover outro administrador.');
          return;
        }

        if (typeof chat.removeParticipants !== 'function') {
          await message.reply('❌ Este grupo não permite banimento por este cliente.');
          return;
        }

        try {
          const result = await chat.removeParticipants([targetId]);

          if (result?.status !== 200) {
            await message.reply('❌ Não consegui concluir o banimento.');
            return;
          }

          clearSpamTrackerForUser(runtimeState.spamTracker, chat.id._serialized, targetId);
          await chat.sendMessage(`🚫 @${targetId.split('@')[0]} foi removido(a) do grupo.`, {
            mentions: [targetId]
          });
        } catch (banError) {
          console.error('Erro ao banir participante:', banError.message);
          await message.reply('❌ Não consegui banir esse membro. Verifique se eu ainda sou admin e se a pessoa está no grupo.');
        }

        return;
      }

      if (normalizedCommand === 'spam on') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem ativar o anti-spam.');
          return;
        }

        runtimeState.antiSpamEnabled = true;
        await message.reply(`✅ ${buildSpamStatusMessage(runtimeState.antiSpamEnabled, runtimeState.antiSpamMaxMessages, runtimeState.antiSpamWindowMs)}`);
        return;
      }

      if (normalizedCommand === 'spam off') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem desativar o anti-spam.');
          return;
        }

        runtimeState.antiSpamEnabled = false;
        await message.reply('✅ Anti-spam desativado.');
        return;
      }

      if (normalizedCommand === 'spam status') {
        await message.reply(buildSpamStatusMessage(
          runtimeState.antiSpamEnabled,
          runtimeState.antiSpamMaxMessages,
          runtimeState.antiSpamWindowMs
        ));
        return;
      }

      if (commandName === 'spam' && commandParts.length === 3) {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem alterar a configuração do anti-spam.');
          return;
        }

        const newLimit = parsePositiveInteger(commandParts[1], 0);
        const newWindowSeconds = parsePositiveInteger(commandParts[2], 0);

        if (!newLimit || !newWindowSeconds) {
          await message.reply(`❌ Use no formato: ${config.botPrefix}spam 5 10`);
          return;
        }

        runtimeState.antiSpamEnabled = true;
        runtimeState.antiSpamMaxMessages = newLimit;
        runtimeState.antiSpamWindowMs = newWindowSeconds * 1000;
        runtimeState.spamTracker.clear();

        await message.reply(`✅ ${buildSpamStatusMessage(runtimeState.antiSpamEnabled, runtimeState.antiSpamMaxMessages, runtimeState.antiSpamWindowMs)}`);
        return;
      }

      if (normalizedCommand === 'links on') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem ativar o bloqueio de links.');
          return;
        }

        runtimeState.blockLinksEnabled = true;
        await message.reply('✅ Bloqueio de links ativado.');
        return;
      }

      if (normalizedCommand === 'links off') {
        if (!senderIsAdmin) {
          await message.reply('❌ Apenas administradores podem desativar o bloqueio de links.');
          return;
        }

        runtimeState.blockLinksEnabled = false;
        await message.reply('✅ Bloqueio de links desativado.');
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  };
}

module.exports = {
  createMessageHandler
};
