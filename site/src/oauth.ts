import type { Context, Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { html } from 'hono/html';
import { newId } from '@archsage/shared';
import type { Db } from './db.ts';
import { layout, message } from './pages.ts';
import type { UserRow } from './posts.ts';
import { randomToken, safeNext, sha256 } from './util.ts';

// Google と Discord のログイン。受け取るのは、その人を見分ける番号だけ（メールアドレスや本名は求めない）。
// 名前はサイトで付けてもらう。初めての人は、名前と年齢と規約の同意を聞いてから利用者を作る

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

export interface OAuthOptions {
  google?: OAuthClient;
  discord?: OAuthClient;
  fetch?: typeof fetch; // テストで差し替える
}

export type ProviderName = 'google' | 'discord';

interface Provider {
  label: string;
  authorize: string;
  token: string;
  scope: string;
  extra?: Record<string, string>;
  // 受け取った鍵から、その人の番号と名前の案を出す
  identify: (tok: Record<string, unknown>, client: OAuthClient, f: typeof fetch) => Promise<{ id: string; name: string }>;
}

const PROVIDERS: Record<ProviderName, Provider> = {
  google: {
    label: 'Google',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid',
    extra: { prompt: 'select_account' },
    // id_token は Google から直接受け取ったものなので、署名は確かめず中身だけ読む（OpenID Connect で認められた読み方）
    identify: async (tok, client) => {
      const part = String(tok.id_token ?? '').split('.')[1];
      if (!part) throw new Error('id_token がありません');
      const claims = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/'))) as { sub?: string; aud?: string; iss?: string };
      if (!claims.sub || claims.aud !== client.clientId || !/^(https:\/\/)?accounts\.google\.com$/.test(claims.iss ?? '')) throw new Error('id_token が正しくありません');
      return { id: claims.sub, name: '' };
    },
  },
  discord: {
    label: 'Discord',
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    scope: 'identify',
    identify: async (tok, _client, f) => {
      const res = await f('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${String(tok.access_token ?? '')}` } });
      if (!res.ok) throw new Error(`Discord ${res.status}`);
      const u = (await res.json()) as { id?: string; username?: string; global_name?: string | null };
      if (!u.id) throw new Error('Discord の番号がありません');
      return { id: u.id, name: u.global_name || u.username || '' };
    },
  },
};

const STATE_MINUTES = 10;
const SIGNUP_MINUTES = 30;
export const NAME_LIMIT = 40;

// 名前を比べるときの形。全角と半角、大文字と小文字、空白の違いは同じ名前と見る
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

// 運営やサイトと見まちがえる名前は使えない
const RESERVED = ['運営', '公式', '管理人', '管理者', 'archsage', 'admin', 'administrator', 'official', 'staff', 'moderator'].map(nameKey);
const reserved = (key: string) => RESERVED.some((r) => key.includes(r));

export function oauthProviders(o: OAuthOptions | undefined): { name: ProviderName; label: string }[] {
  return (Object.keys(PROVIDERS) as ProviderName[]).filter((n) => o?.[n]).map((n) => ({ name: n, label: PROVIDERS[n].label }));
}

interface Deps<E extends { Variables: { viewer: UserRow | null } }> {
  app: Hono<E>;
  db: Db;
  origin: string;
  termsVersion: number;
  oauth: OAuthOptions;
  now: () => number;
  startSession: (c: Context<E>, userId: string) => Promise<void>;
}

export function mountOAuth<E extends { Variables: { viewer: UserRow | null } }>(d: Deps<E>): void {
  const { app, db, origin, oauth, now } = d;
  const f = oauth.fetch ?? fetch;
  const secure = origin.startsWith('https:');
  const callback = (name: ProviderName) => `${origin}/login/${name}/callback`;

  for (const name of Object.keys(PROVIDERS) as ProviderName[]) {
    const client = oauth[name];
    if (!client) continue;
    const p = PROVIDERS[name];

    app.get(`/login/${name}`, async (c) => {
      const state = randomToken();
      const verifier = randomToken();
      // 行って戻るまでの印はクッキーに置く。戻ってきた state と合わなければ受け付けない
      setCookie(c, `oauth_${name}`, JSON.stringify({ state, verifier, next: safeNext(c.req.query('next')) }), { httpOnly: true, sameSite: 'Lax', path: `/login/${name}`, secure, maxAge: STATE_MINUTES * 60 });
      const q = new URLSearchParams({ client_id: client.clientId, redirect_uri: callback(name), response_type: 'code', scope: p.scope, state, code_challenge: await sha256(verifier), code_challenge_method: 'S256', ...p.extra });
      return c.redirect(`${p.authorize}?${q}`);
    });

    app.get(`/login/${name}/callback`, async (c) => {
      const fail = (why: string) => c.html(message('ログインできませんでした', null, why, { href: '/login', label: 'ログインに戻る' }), 400);
      let saved: { state?: string; verifier?: string; next?: string } = {};
      try {
        saved = JSON.parse(getCookie(c, `oauth_${name}`) ?? '{}');
      } catch {
        /* 壊れていれば空のまま */
      }
      deleteCookie(c, `oauth_${name}`, { path: `/login/${name}` });
      if (c.req.query('error')) return fail(`${p.label}でのログインが取りやめになりました`);
      const code = c.req.query('code');
      if (!code || !saved.state || !saved.verifier || c.req.query('state') !== saved.state) return fail('時間がたちすぎたか、別の画面から戻ってきました。もう一度ログインしてください');

      let who: { id: string; name: string };
      try {
        const res = await f(p.token, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: callback(name), client_id: client.clientId, client_secret: client.clientSecret, code_verifier: saved.verifier }),
        });
        if (!res.ok) throw new Error(`${p.label} ${res.status}`);
        who = await p.identify((await res.json()) as Record<string, unknown>, client, f);
      } catch (e) {
        console.error('oauth', name, (e as Error).message);
        return fail(`${p.label}との確かめに失敗しました。少し待ってからもう一度試してください`);
      }

      const next = safeNext(saved.next);
      const user = await db.get<UserRow>('select * from users where provider = ? and provider_user_id = ?', name, who.id);
      if (user) {
        await d.startSession(c, user.id);
        return c.redirect(next);
      }
      // 初めての人は、名前と年齢と同意を聞いてから作る。誰なのかはサイトの中に置き、クッキーには引き換えの番号だけ渡す
      const key = randomToken();
      await db.run('delete from signups where expires_at < ?', now());
      await db.run('insert into signups (id, provider, provider_user_id, suggested_name, next, expires_at) values (?, ?, ?, ?, ?, ?)', await sha256(key), name, who.id, who.name.slice(0, NAME_LIMIT), next, now() + SIGNUP_MINUTES * 6e4);
      setCookie(c, 'signup', key, { httpOnly: true, sameSite: 'Lax', path: '/signup', secure, maxAge: SIGNUP_MINUTES * 60 });
      return c.redirect('/signup');
    });
  }

  type SignupRow = { id: string; provider: ProviderName; provider_user_id: string; suggested_name: string; next: string; expires_at: number };
  const pending = async (c: Context<E>) => {
    const key = getCookie(c, 'signup');
    if (!key) return undefined;
    const row = await db.get<SignupRow>('select * from signups where id = ?', await sha256(key));
    return row && row.expires_at > now() ? row : undefined;
  };
  const expired = (c: Context<E>) => c.html(message('時間がたちすぎました', null, 'はじめからログインし直してください', { href: '/login', label: 'ログインに戻る' }), 400);

  const form = (row: SignupRow, error = '', name = row.suggested_name) =>
    layout(
      'はじめての登録',
      null,
      html`<div style="max-width:440px;margin:24px auto 0" class="stack">
        <form method="post" action="/signup" class="card stack">
          <div><h1 style="font-size:20px;font-weight:600">はじめての登録</h1><p class="faint">${PROVIDERS[row.provider].label}でログインしました。サイトで使う名前を決めてください</p></div>
          ${error ? html`<p style="color:var(--danger)">${error}</p>` : ''}
          <label class="field"><span>名前（投稿に出ます。ほかの人と同じ名前は使えません。今のところ、あとからは変えられません）</span><input name="name" value="${name}" maxlength="${NAME_LIMIT}" required /></label>
          <div class="field"><span>18歳以上ですか</span><label class="choice"><input type="radio" name="adult" value="1" /> はい</label><label class="choice"><input type="radio" name="adult" value="0" checked /> いいえ</label></div>
          <label class="choice"><input type="checkbox" name="terms" value="1" /> <span><a href="/terms" target="_blank">規約</a>、<a href="/guidelines" target="_blank">ガイドライン</a>、<a href="/privacy" target="_blank">プライバシーポリシー</a>に同意する</span></label>
          <button class="btn btn-primary btn-block">登録する</button>
        </form>
      </div>`,
    );

  app.get('/signup', async (c) => {
    const row = await pending(c);
    return row ? c.html(form(row)) : expired(c);
  });

  app.post('/signup', async (c) => {
    const row = await pending(c);
    if (!row) return expired(c);
    const body = await c.req.parseBody();
    const name = String(body.name ?? '').trim();
    if (!name || name.length > NAME_LIMIT) return c.html(form(row, `名前は1〜${NAME_LIMIT}文字で入れてください`, name), 400);
    const key = nameKey(name);
    if (!key || reserved(key)) return c.html(form(row, '運営やサイトとまぎらわしい名前は使えません', name), 400);
    // name_key がない前からの利用者とも比べる（そちらは小文字にして比べる）
    const taken = await db.get('select 1 from users where name_key = ? or (name_key is null and lower(replace(display_name, \' \', \'\')) = ?)', key, key);
    if (taken) return c.html(form(row, 'その名前はもう使われています。別の名前にしてください', name), 400);
    if (body.terms !== '1') return c.html(form(row, '登録するには、規約とガイドラインへの同意が要ります', name), 400);
    // 同じ人が2つの画面で登録したときは、先にできた方を使う
    let user = await db.get<UserRow>('select * from users where provider = ? and provider_user_id = ?', row.provider, row.provider_user_id);
    if (!user) {
      const id = newId();
      try {
        await db.run('insert into users (id, provider, provider_user_id, display_name, name_key, adult, terms_version, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)', id, row.provider, row.provider_user_id, name, key, body.adult === '1' ? 1 : 0, d.termsVersion, now());
      } catch (e) {
        // 同じ名前の登録が、ほぼ同時にあったとき
        if (/unique/i.test((e as Error).message)) return c.html(form(row, 'その名前はもう使われています。別の名前にしてください', name), 400);
        throw e;
      }
      user = (await db.get<UserRow>('select * from users where id = ?', id))!;
    }
    await db.run('delete from signups where id = ?', row.id);
    deleteCookie(c, 'signup', { path: '/signup' });
    await d.startSession(c, user.id);
    return c.redirect(safeNext(row.next));
  });
}
