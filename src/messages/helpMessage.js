function buildHelpMessage(botPrefix) {
  return [
    '🤖 *Comandos disponíveis*',
    '',
    `${botPrefix}ping - testa se o bot está online`,
    `${botPrefix}menu / ${botPrefix}ajuda / ${botPrefix}help - mostra este menu`,
    `${botPrefix}id - mostra o ID do grupo`,
    `${botPrefix}pix - mostra a chave Pix para ajudar os adm`,
    `${botPrefix}meme [tema] - busca meme na internet e envia no grupo`,
    `${botPrefix}musica nome - busca música na internet e manda prévia/link`,
    `${botPrefix}figurinha / ${botPrefix}fig / ${botPrefix}sticker - cria figurinha da mídia enviada ou respondida`,
    `${botPrefix}foto / ${botPrefix}perfil / ${botPrefix}pfp @membro - baixa a foto de perfil`,
    `${botPrefix}censurar - apaga a mensagem respondida`,
    `${botPrefix}daradm @membro - promove membro a administrador`,
    `${botPrefix}tiraradm @membro - remove cargo de administrador`,
    `${botPrefix}banir / ${botPrefix}ban @membro - remove membro por menção, resposta ou número`,
    `${botPrefix}grupo fechar / ${botPrefix}fechargrupo - só administradores podem falar`,
    `${botPrefix}grupo abrir / ${botPrefix}abrirgrupo - libera mensagens para todos`,
    `${botPrefix}links on - ativa bloqueio de links`,
    `${botPrefix}links off - desativa bloqueio de links`,
    `${botPrefix}spam on - ativa o anti-spam`,
    `${botPrefix}spam off - desativa o anti-spam`,
    `${botPrefix}spam status - mostra a configuração atual do anti-spam`,
    `${botPrefix}spam 5 10 - permite 5 mensagens em 10 segundos`,
    '',
    'Obs.: os comandos de configuração funcionam melhor quando enviados por administradores.'
  ].join('\n');
}

module.exports = {
  buildHelpMessage
};
