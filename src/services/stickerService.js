async function resolveStickerSourceMessage(message) {
  if (message?.hasMedia) return message;
  if (!message?.hasQuotedMsg) return null;

  try {
    const quotedMessage = await message.getQuotedMessage();
    return quotedMessage?.hasMedia ? quotedMessage : null;
  } catch (error) {
    console.error('Erro ao obter a mensagem respondida para figurinha:', error.message);
    return null;
  }
}

function isStickerCompatibleMedia(media) {
  if (!media?.mimetype) return false;
  return media.mimetype.includes('image') || media.mimetype.includes('video');
}

module.exports = {
  isStickerCompatibleMedia,
  resolveStickerSourceMessage
};
