// Web Crypto だけを使うので、Node と Cloudflare Workers の両方で動く

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomToken(bytes = 32): string {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text: string | Uint8Array): Promise<string> {
  const data = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>)));
}

// 画像として読めるものだけ受け付ける。中身の先頭を見て形式を決め、拡張子は信用しない
export function imageKind(b: Uint8Array): 'png' | 'jpg' | 'webp' | undefined {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b.length > 12 && String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return 'webp';
  return undefined;
}

export const IMAGE_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' } as const;

// ログインのあとに戻る先は、このサイトの中だけにする
export function safeNext(next: string | undefined): string {
  return next && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '/';
}
