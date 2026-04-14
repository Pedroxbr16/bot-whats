function textContainsLink(text) {
  if (!text) return false;

  const linkRegex = /((https?:\/\/)|(www\.)|([a-zA-Z0-9-]+\.(com|com\.br|net|org|io|gg|dev|app|info|co|me|ly|gl|tv|xyz|online|store|site|blog|edu|gov)(\/[^\s]*)?))/gi;
  return linkRegex.test(text);
}

function isSameWhatsAppUser(leftId, rightId) {
  if (!leftId || !rightId) return false;
  if (leftId === rightId) return true;

  const leftNormalized = String(leftId).split('@')[0].trim().toLowerCase();
  const rightNormalized = String(rightId).split('@')[0].trim().toLowerCase();

  if (leftNormalized && leftNormalized === rightNormalized) return true;

  const leftDigits = leftNormalized.replace(/\D/g, '');
  const rightDigits = rightNormalized.replace(/\D/g, '');

  return Boolean(leftDigits && rightDigits && leftDigits === rightDigits);
}

function getSerializedMessageId(message) {
  return message?.id?._serialized || message?.id?.id || null;
}

module.exports = {
  getSerializedMessageId,
  textContainsLink,
  isSameWhatsAppUser
};
