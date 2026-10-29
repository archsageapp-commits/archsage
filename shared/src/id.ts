const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

export function newId(length = 12): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return s;
}

// プレイヤーを表す personId
export const USER_ID = 'user';
