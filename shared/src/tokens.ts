// トークン数は文字数から見積もる。日本語は1文字1トークン強、英数字は4文字弱で1トークン
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) < 128) ascii++;
    else other++;
  }
  return Math.ceil(ascii / 3.5 + other * 1.1);
}

export function estimateMessagesTokens(messages: { content: string }[]): number {
  // 1件ごとの役割などの分を足す
  return messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 0);
}
