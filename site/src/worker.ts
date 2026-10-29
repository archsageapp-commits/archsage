import { createSiteApp } from './app.ts';
import { cfImages, d1Db, r2Blobs, type D1Database, type ImagesBinding, type R2Bucket } from './cloudflare.ts';

// Cloudflare Workers の入口。設定は wrangler.toml の vars と bindings から受け取る
export interface Env {
  DB: D1Database;
  BLOBS: R2Bucket;
  IMAGES: ImagesBinding;
  BASE_URL: string;
  TERMS_VERSION?: string;
  DEV_LOGIN?: string; // "1" で開発用の仮のログインを出す。本番では入れない
  ALLOWED_COUNTRIES?: string; // 例 "JP"。空なら絞らない
  DEV_LOGIN_KEY?: string; // 仮のログインの合言葉。wrangler secret put で入れる。ないと仮のログインは出さない
  // ログインの鍵。4つとも wrangler secret put で入れる。ID と秘密の両方があるものだけログインに出す
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  DISCORD_CLIENT_ID?: string;
  DISCORD_CLIENT_SECRET?: string;
}

const client = (id?: string, secret?: string) => (id && secret ? { clientId: id, clientSecret: secret } : undefined);

// 同じ環境のあいだは作ったアプリを使い回す
let cached: { env: Env; app: ReturnType<typeof createSiteApp> } | undefined;

export default {
  fetch(req: Request, env: Env): Response | Promise<Response> {
    // 国は Cloudflare が付ける req.cf.country で見る。分からないとき（手元で動かしたとき）は通す
    const allowed = (env.ALLOWED_COUNTRIES ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const country = (req as Request & { cf?: { country?: string } }).cf?.country;
    if (allowed.length && country && !allowed.includes(country.toUpperCase())) {
      return new Response('このサイトは日本国内からのみ利用できます。\nThis site is available only from Japan.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (!cached || cached.env !== env) {
      const app = createSiteApp({
        db: d1Db(env.DB),
        blobs: r2Blobs(env.BLOBS),
        images: cfImages(env.IMAGES),
        baseUrl: env.BASE_URL.replace(/\/+$/, ''),
        termsVersion: Number(env.TERMS_VERSION ?? 1),
        // ネットの上では、合言葉がないかぎり仮のログインを出さない
        devLogin: env.DEV_LOGIN === '1' && !!env.DEV_LOGIN_KEY,
        devLoginKey: env.DEV_LOGIN_KEY,
        oauth: { google: client(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET), discord: client(env.DISCORD_CLIENT_ID, env.DISCORD_CLIENT_SECRET) },
      });
      cached = { env, app };
    }
    return cached.app.fetch(req);
  },
};
