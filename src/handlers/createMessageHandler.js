const { buildHelpMessage } = require('../messages/helpMessage');
const { isStickerCompatibleMedia, resolveStickerSourceMessage } = require('../services/stickerService');
const {
  buildAntiSpamStatusMessage,
  buildSpamTrackerKey,
  clearTrackedSpamForParticipant,
  evaluateSpamBurst
} = require('../state/runtimeState');
const {
  extractCommandArguments,
  getSerializedMessageId,
  isSameWhatsAppUser,
  parsePositiveInteger,
  textContainsLink
} = require('../utils/common');

function createGroupMessageHandler({ client, config, runtimeState, groupService, internetService }) {
  function rememberProcessedMessage(serializedMessageId) {
    if (!serializedMessageId) return false;
    if (runtimeState.processedMessages.has(serializedMessageId)) return true;

    runtimeState.processedMessages.add(serializedMessageId);

    // Remove ids antigos para o cache não crescer indefinidamente.
    setTimeout(() => {
      runtimeState.processedMessages.delete(serializedMessageId);
    }, 5 * 60 * 1000);c

    return false;
  }

  async function ensureSenderIsAdmin(message, senderIsAdmin, errorMessage) {
    if (senderIsAdmin) return true;

    await message.reply(errorMessage);
    return false;
  }

  async function ensureBotIsAdmin(chat, message, errorMessage) {
    const botId = client.info?.wid?._serialized || '';

    if (!botId || !(await groupService.isParticipantAdmin(chat, botId))) {
      await message.reply(errorMessage);
      return null;
    }

    return botId;
  }

  async function applyBlockedLinksPolicy({ chat, message, messageText, senderId, senderIsAdmin }) {
    if (!runtimeState.blockLinksEnabled) return false;
    if (!textContainsLink(messageText)) return false;
    if (config.ignoreAdmins && senderIsAdmin) return false;

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

    return true;
  }

  async function applyAntiSpamPolicy({ chat, message, messageText, senderId, senderIsAdmin }) {
    if (!runtimeState.antiSpamEnabled) return false;
    if (!messageText) return false;
    if (config.ignoreAdmins && senderIsAdmin) return false;

    const spamTrackerKey = buildSpamTrackerKey(chat.id._serialized, senderId);
    const now = Date.now();
    const trackedTimestamps = runtimeState.spamTracker.get(spamTrackerKey) || [];
    const { recentMessages, exceeded } = evaluateSpamBurst(
      trackedTimestamps,
      now,
      runtimeState.antiSpamMaxMessages,
      runtimeState.antiSpamWindowMs
    );

    recentMessages.push(now);
    runtimeState.spamTracker.set(spamTrackerKey, recentMessages);

    setTimeout(() => {
      const currentTimestamps = runtimeState.spamTracker.get(spamTrackerKey) || [];
      const timestampsStillInsideWindow = currentTimestamps.filter((timestamp) => {
        return Date.now() - timestamp <= runtimeState.antiSpamWindowMs;
      });

      if (timestampsStillInsideWindow.length > 0) {
        runtimeState.spamTracker.set(spamTrackerKey, timestampsStillInsideWindow);
        return;
      }

      runtimeState.spamTracker.delete(spamTrackerKey);
    }, runtimeState.antiSpamWindowMs);

    if (!exceeded) return false;

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

      const blockedByAntiSpamPolicy = await applyAntiSpamPolicy({
        chat,
        message,
        messageText,
        senderId,
        senderIsAdmin
      });
      if (blockedByAntiSpamPolicy) return;

      if (!messageText.startsWith(config.botPrefix)) return;

      const rawCommand = messageText.slice(config.botPrefix.length).trim();
      const normalizedCommand = rawCommand.toLowerCase();
      const commandParts = rawCommand.split(/\s+/).filter(Boolean);
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
        await internetService.sendMemeSearchResult(chat, message, extractCommandArguments(commandParts));
        return;
      }

      if (commandName === 'musica' || commandName === 'música') {
        await internetService.sendMusicSearchResult(chat, message, extractCommandArguments(commandParts));
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
        const targetParticipantId = await groupService.resolveTargetParticipantId(chat, message, commandParts);
        if (!targetParticipantId) {
          await message.reply(`❌ Marque, responda ou informe o número de quem você quer baixar a foto. Ex.: ${config.botPrefix}foto @usuario`);
          return;
        }

        try {
          const profilePhoto = await groupService.resolveProfilePhotoForParticipant(targetParticipantId);

          if (!profilePhoto?.media) {
            await message.reply('❌ Não consegui acessar a foto de perfil desse contato. A privacidade dele pode estar bloqueando.');
            return;
          }

          await chat.sendMessage(profilePhoto.media, {
            caption: `📸 Foto de perfil de @${targetParticipantId.split('@')[0]}`,
            mentions: [targetParticipantId],
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
        const senderCanCloseGroup = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem fechar o grupo.'
        );
        if (!senderCanCloseGroup) return;

        const botId = await ensureBotIsAdmin(
          chat,
          message,
          '❌ Preciso ser administrador do grupo para fechar o envio de mensagens.'
        );
        if (!botId) return;

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
        const senderCanOpenGroup = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem abrir o grupo.'
        );
        if (!senderCanOpenGroup) return;

        const botId = await ensureBotIsAdmin(
          chat,
          message,
          '❌ Preciso ser administrador do grupo para liberar o envio de mensagens.'
        );
        if (!botId) return;

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
        const senderCanPromote = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem dar admin.'
        );
        if (!senderCanPromote) return;

        const botId = await ensureBotIsAdmin(
          chat,
          message,
          '❌ Preciso ser administrador do grupo para promover alguém.'
        );
        if (!botId) return;

        const targetParticipantId = await groupService.resolveTargetParticipantId(chat, message, commandParts);
        if (!targetParticipantId) {
          await message.reply(`❌ Marque, responda ou informe o número de quem deve virar admin. Ex.: ${config.botPrefix}daradm @usuario`);
          return;
        }

        if (isSameWhatsAppUser(targetParticipantId, botId)) {
          await message.reply('❌ Eu já sou admin.');
          return;
        }

        if (await groupService.isParticipantAdmin(chat, targetParticipantId)) {
          await message.reply('❌ Esse membro já é administrador.');
          return;
        }

        if (typeof chat.promoteParticipants !== 'function') {
          await message.reply('❌ Este grupo não permite promover participantes por este cliente.');
          return;
        }

        try {
          const result = await chat.promoteParticipants([targetParticipantId]);

          if (result?.status !== 200) {
            await message.reply('❌ Não consegui promover esse membro.');
            return;
          }

          await chat.sendMessage(`👑 @${targetParticipantId.split('@')[0]} agora é administrador(a).`, {
            mentions: [targetParticipantId]
          });
        } catch (promoteError) {
          console.error('Erro ao promover participante:', promoteError.message);
          await message.reply('❌ Não consegui dar admin para esse membro.');
        }

        return;
      }

      if (commandName === 'tiraradm' || commandName === 'rebaixar') {
        const senderCanDemote = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem tirar admin.'
        );
        if (!senderCanDemote) return;

        const botId = await ensureBotIsAdmin(
          chat,
          message,
          '❌ Preciso ser administrador do grupo para remover admin de alguém.'
        );
        if (!botId) return;

        const targetParticipantId = await groupService.resolveTargetParticipantId(chat, message, commandParts);
        if (!targetParticipantId) {
          await message.reply(`❌ Marque, responda ou informe o número de quem deve perder o cargo. Ex.: ${config.botPrefix}tiraradm @usuario`);
          return;
        }

        if (isSameWhatsAppUser(targetParticipantId, senderId)) {
          await message.reply('❌ Você não pode remover seu próprio cargo por aqui.');
          return;
        }

        if (isSameWhatsAppUser(targetParticipantId, botId)) {
          await message.reply('❌ Não vou remover meu próprio cargo de admin.');
          return;
        }

        if (!(await groupService.isParticipantAdmin(chat, targetParticipantId))) {
          await message.reply('❌ Esse membro não é administrador.');
          return;
        }

        if (typeof chat.demoteParticipants !== 'function') {
          await message.reply('❌ Este grupo não permite rebaixar participantes por este cliente.');
          return;
        }

        try {
          const result = await chat.demoteParticipants([targetParticipantId]);

          if (result?.status !== 200) {
            await message.reply('❌ Não consegui remover o cargo desse admin.');
            return;
          }

          await chat.sendMessage(`⬇️ @${targetParticipantId.split('@')[0]} não é mais administrador(a).`, {
            mentions: [targetParticipantId]
          });
        } catch (demoteError) {
          console.error('Erro ao rebaixar participante:', demoteError.message);
          await message.reply('❌ Não consegui tirar o admin desse membro.');
        }

        return;
      }

      if (normalizedCommand === 'censurar' || normalizedCommand === 'apagar' || normalizedCommand === 'del') {
        const senderCanDeleteMessages = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem apagar mensagens.'
        );
        if (!senderCanDeleteMessages) return;

        const botId = await ensureBotIsAdmin(
          chat,
          message,
          '❌ Preciso ser administrador do grupo para apagar mensagens.'
        );
        if (!botId) return;

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
        const senderCanBan = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem banir membros.'
        );
        if (!senderCanBan) return;

        const botId = await ensureBotIsAdmin(
          chat,
          message,
          '❌ Preciso ser administrador do grupo para conseguir banir alguém.'
        );
        if (!botId) return;

        const targetParticipantId = await groupService.resolveTargetParticipantId(chat, message, commandParts);
        if (!targetParticipantId) {
          await message.reply(`❌ Marque, responda ou informe o número de quem deve ser removido. Ex.: ${config.botPrefix}banir @usuario`);
          return;
        }

        if (isSameWhatsAppUser(targetParticipantId, senderId)) {
          await message.reply('❌ Você não pode banir a si mesmo.');
          return;
        }

        if (isSameWhatsAppUser(targetParticipantId, botId)) {
          await message.reply('❌ Não vou me banir do grupo.');
          return;
        }

        if (await groupService.isParticipantAdmin(chat, targetParticipantId)) {
          await message.reply('❌ Não vou remover outro administrador.');
          return;
        }

        if (typeof chat.removeParticipants !== 'function') {
          await message.reply('❌ Este grupo não permite banimento por este cliente.');
          return;
        }

        try {
          const result = await chat.removeParticipants([targetParticipantId]);

          if (result?.status !== 200) {
            await message.reply('❌ Não consegui concluir o banimento.');
            return;
          }

          clearTrackedSpamForParticipant(runtimeState.spamTracker, chat.id._serialized, targetParticipantId);
          await chat.sendMessage(`🚫 @${targetParticipantId.split('@')[0]} foi removido(a) do grupo.`, {
            mentions: [targetParticipantId]
          });
        } catch (banError) {
          console.error('Erro ao banir participante:', banError.message);
          await message.reply('❌ Não consegui banir esse membro. Verifique se eu ainda sou admin e se a pessoa está no grupo.');
        }

        return;
      }

      if (normalizedCommand === 'spam on') {
        const senderCanEnableAntiSpam = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem ativar o anti-spam.'
        );
        if (!senderCanEnableAntiSpam) return;

        runtimeState.antiSpamEnabled = true;
        await message.reply(`✅ ${buildAntiSpamStatusMessage(
          runtimeState.antiSpamEnabled,
          runtimeState.antiSpamMaxMessages,
          runtimeState.antiSpamWindowMs
        )}`);
        return;
      }

      if (normalizedCommand === 'spam off') {
        const senderCanDisableAntiSpam = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem desativar o anti-spam.'
        );
        if (!senderCanDisableAntiSpam) return;

        runtimeState.antiSpamEnabled = false;
        await message.reply('✅ Anti-spam desativado.');
        return;
      }

      if (normalizedCommand === 'spam status') {
        await message.reply(buildAntiSpamStatusMessage(
          runtimeState.antiSpamEnabled,
          runtimeState.antiSpamMaxMessages,
          runtimeState.antiSpamWindowMs
        ));
        return;
      }

      if (commandName === 'spam' && commandParts.length === 3) {
        const senderCanConfigureAntiSpam = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem alterar a configuração do anti-spam.'
        );
        if (!senderCanConfigureAntiSpam) return;

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

        await message.reply(`✅ ${buildAntiSpamStatusMessage(
          runtimeState.antiSpamEnabled,
          runtimeState.antiSpamMaxMessages,
          runtimeState.antiSpamWindowMs
        )}`);
        return;
      }

      if (normalizedCommand === 'links on') {
        const senderCanEnableLinkBlock = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem ativar o bloqueio de links.'
        );
        if (!senderCanEnableLinkBlock) return;

        runtimeState.blockLinksEnabled = true;
        await message.reply('✅ Bloqueio de links ativado.');
        return;
      }

      if (normalizedCommand === 'links off') {
        const senderCanDisableLinkBlock = await ensureSenderIsAdmin(
          message,
          senderIsAdmin,
          '❌ Apenas administradores podem desativar o bloqueio de links.'
        );
        if (!senderCanDisableLinkBlock) return;

        runtimeState.blockLinksEnabled = false;
        await message.reply('✅ Bloqueio de links desativado.');
      }
    } catch (error) {
      console.error('Erro ao processar mensagem:', error);
    }
  };
}

module.exports = {
  createGroupMessageHandler
};
