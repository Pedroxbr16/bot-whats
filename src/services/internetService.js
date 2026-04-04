const { fetchJson, sendMediaFromUrl } = require('./mediaService');
const {
  formatMillisecondsAsDuration,
  getHighResolutionArtworkUrl,
  normalizeSearchText,
  pickRandomItem
} = require('../utils/common');

function getTenorMediaUrl(result) {
  return result?.media_formats?.gif?.url ||
    result?.media_formats?.mediumgif?.url ||
    result?.media_formats?.tinygif?.url ||
    result?.media?.[0]?.gif?.url ||
    result?.media?.[0]?.mediumgif?.url ||
    result?.media?.[0]?.tinygif?.url ||
    '';
}

async function searchITunesCatalog(term, entity, options = {}) {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', term);
  url.searchParams.set('entity', entity);
  url.searchParams.set('limit', String(options.limit || 10));
  url.searchParams.set('country', options.country || 'BR');
  url.searchParams.set('lang', options.lang || 'pt_br');

  if (options.media) {
    url.searchParams.set('media', options.media);
  }

  const data = await fetchJson(url.toString());
  return Array.isArray(data?.results) ? data.results : [];
}

function createInternetService(config) {
  async function sendMemeSearchResult(chat, message, query) {
    const normalizedQuery = normalizeSearchText(query);
    const effectiveQuery = normalizedQuery || 'meme';

    try {
      // Primeiro tenta GIFs do Tenor; se não aparecer nada útil, cai para memes estáticos.
      const tenorUrl = new URL('https://g.tenor.com/v1/search');
      tenorUrl.searchParams.set('q', `${effectiveQuery} meme`);
      tenorUrl.searchParams.set('key', config.tenorApiKey);
      tenorUrl.searchParams.set('limit', '20');
      tenorUrl.searchParams.set('locale', 'pt_BR');
      tenorUrl.searchParams.set('contentfilter', 'medium');

      const tenorData = await fetchJson(tenorUrl.toString());
      const tenorResults = Array.isArray(tenorData?.results) ? tenorData.results : [];
      const selectedTenorResult = pickRandomItem(tenorResults);
      const tenorMediaUrl = getTenorMediaUrl(selectedTenorResult);

      if (tenorMediaUrl) {
        await sendMediaFromUrl(chat, tenorMediaUrl, {
          filename: `meme-${selectedTenorResult?.id || Date.now()}.gif`,
          caption: `🤣 Meme: ${query || 'aleatorio'}`,
          quotedMessageId: message.id._serialized
        });
        return;
      }
    } catch (error) {
      console.error('Erro ao buscar meme na Tenor:', error.message);
    }

    try {
      const data = await fetchJson('https://api.imgflip.com/get_memes');
      const memes = Array.isArray(data?.data?.memes) ? data.data.memes : [];
      const filteredMemes = normalizedQuery
        ? memes.filter((meme) => normalizeSearchText(meme?.name).includes(normalizedQuery))
        : memes;

      const selectedMeme = pickRandomItem(filteredMemes);
      if (!selectedMeme?.url) {
        await message.reply(query
          ? `❌ Não achei meme na internet para "${query}".`
          : '❌ Não achei meme na internet agora.');
        return;
      }

      await sendMediaFromUrl(chat, selectedMeme.url, {
        filename: `meme-${selectedMeme.id || Date.now()}.jpg`,
        caption: `🤣 Meme: ${selectedMeme.name || query || 'sem titulo'}`,
        quotedMessageId: message.id._serialized,
        sendMediaAsHd: true
      });
    } catch (error) {
      console.error('Erro ao buscar meme na internet:', error.message);
      await message.reply('❌ Não consegui buscar meme na internet agora.');
    }
  }

  async function sendMusicSearchResult(chat, message, query) {
    if (!query) {
      await message.reply(`❌ Use no formato: ${config.botPrefix}musica nome da musica`);
      return;
    }

    try {
      const results = await searchITunesCatalog(query, 'song');
      const selectedTrack = results.find((track) => track?.previewUrl) || results[0];

      if (!selectedTrack) {
        await message.reply(`❌ Não achei música para "${query}".`);
        return;
      }

      const coverUrl = getHighResolutionArtworkUrl(selectedTrack.artworkUrl100);
      const infoMessage = [
        `🎵 *${selectedTrack.trackName || 'Musica'}*`,
        `👤 ${selectedTrack.artistName || 'Artista desconhecido'}`,
        selectedTrack.collectionName ? `💿 ${selectedTrack.collectionName}` : null,
        selectedTrack.trackTimeMillis ? `⏱️ ${formatMillisecondsAsDuration(selectedTrack.trackTimeMillis)}` : null,
        selectedTrack.trackViewUrl ? `🔗 ${selectedTrack.trackViewUrl}` : null
      ].filter(Boolean).join('\n');

      if (coverUrl) {
        await sendMediaFromUrl(chat, coverUrl, {
          filename: `musica-${selectedTrack.trackId || Date.now()}.jpg`,
          caption: infoMessage,
          quotedMessageId: message.id._serialized,
          sendMediaAsHd: true
        });
      } else {
        await chat.sendMessage(infoMessage, {
          quotedMessageId: message.id._serialized
        });
      }

      if (selectedTrack.previewUrl) {
        await sendMediaFromUrl(chat, selectedTrack.previewUrl, {
          filename: `preview-${selectedTrack.trackId || Date.now()}.m4a`,
          quotedMessageId: message.id._serialized
        });
      }
    } catch (error) {
      console.error('Erro ao buscar musica na internet:', error.message);
      await message.reply('❌ Não consegui buscar música na internet agora.');
    }
  }

  return {
    sendMemeSearchResult,
    sendMusicSearchResult
  };
}

module.exports = {
  createInternetService
};
