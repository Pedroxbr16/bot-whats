function containsLink(text) {
  if (!text) return false;

  const linkRegex = /((https?:\/\/)|(www\.)|([a-zA-Z0-9-]+\.(com|com\.br|net|org|io|gg|dev|app|info|co|me|ly|gl|tv|xyz|online|store|site|blog|edu|gov)(\/[^\s]*)?))/gi;
  return linkRegex.test(text);
}

function normalizeJid(id) {
  if (!id || typeof id !== 'string') return '';

  const [user = ''] = id.split('@');
  return user.trim().toLowerCase();
}

function extractDigits(value) {
  if (!value) return '';
  return value.replace(/\D/g, '');
}

function isSameWhatsAppUser(leftId, rightId) {
  if (!leftId || !rightId) return false;
  if (leftId === rightId) return true;

  const leftNormalized = normalizeJid(leftId);
  const rightNormalized = normalizeJid(rightId);

  if (leftNormalized && leftNormalized === rightNormalized) return true;

  const leftDigits = extractDigits(leftNormalized);
  const rightDigits = extractDigits(rightNormalized);

  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}

function getMessageUniqueId(message) {
  return message?.id?._serialized || message?.id?.id || null;
}

function parsePositiveInteger(value, fallbackValue) {
  const parsedValue = Number.parseInt(value, 10);
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallbackValue;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function buildCommandQuery(commandParts) {
  return commandParts.slice(1).join(' ').trim();
}

function getRandomItem(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return items[Math.floor(Math.random() * items.length)] || null;
}

function upgradeAppleArtworkUrl(url) {
  if (!url) return '';
  return url.replace(/\/\d+x\d+bb\./, '/1000x1000bb.');
}

function formatDurationMs(durationMs) {
  const totalSeconds = Math.max(0, Math.floor(Number(durationMs || 0) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

module.exports = {
  buildCommandQuery,
  containsLink,
  extractDigits,
  formatDurationMs,
  getMessageUniqueId,
  getRandomItem,
  isSameWhatsAppUser,
  normalizeJid,
  normalizeSearchText,
  parsePositiveInteger,
  upgradeAppleArtworkUrl
};
