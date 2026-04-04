const { MessageMedia } = require('whatsapp-web.js');

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      accept: 'application/json',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.json();
}

async function sendMediaFromUrl(chat, mediaUrl, options = {}) {
  const media = await MessageMedia.fromUrl(mediaUrl, {
    unsafeMime: true,
    filename: options.filename
  });

  return chat.sendMessage(media, {
    quotedMessageId: options.quotedMessageId,
    caption: options.caption,
    mentions: options.mentions,
    sendMediaAsHd: options.sendMediaAsHd
  });
}

module.exports = {
  fetchJson,
  sendMediaFromUrl
};
