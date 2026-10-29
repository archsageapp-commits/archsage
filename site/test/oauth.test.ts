import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSiteApp } from '../src/app.ts';
import { nodeBlobs, nodeDb } from '../src/nodeStore.ts';
import { b64url, sha256 } from '../src/util.ts';

// Google と Discord の向こう側は、ここで偽物を立てる
const BASE = 'https://site.test';
const dir = mkdtempSync(join(tmpdir(), 'archsage-oauth-'));
const db = nodeDb(':memory:');
const google = { clientId: 'g-id', clientSecret: 'g-secret' };
const discord = { clientId: 'd-id', clientSecret: 'd-secret' };
const seen: { url: string; body?: URLSearchParams }[] = [];
const jwt = (claims: object) => `x.${b64url(new TextEncoder().encode(JSON.stringify(claims)))}.y`;
let googleSub = 'g-user-1';

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const body = init?.body instanceof URLSearchParams ? init.body : undefined;
  seen.push({ url, body });
  if (url === 'https://oauth2.googleapis.com/token') {
    return Response.json({ access_token: 'a', id_token: jwt({ sub: googleSub, aud: google.clientId, iss: 'https://accounts.google.com' }) });
  }
  if (url === 'https://discord.com/api/oauth2/token') return Response.json({ access_token: 'discord-token' });
  if (url === 'https://discord.com/api/users/@me') {
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer discord-token');
    return Response.json({ id: 'd-user-1', username: 'dname', global_name: 'ディスコの名前' });
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const app = createSiteApp({ db, blobs: nodeBlobs(dir), baseUrl: BASE, termsVersion: 3, oauth: { google, discord, fetch: fakeFetch } });

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

const cookiesOf = (res: Response) => Object.fromEntries(res.headers.getSetCookie().map((c) => c.split(';')[0].split('=')).map(([k, ...v]) => [k, v.join('=')]));

function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.method && init.method !== 'GET') headers.set('origin', BASE);
  return app.request(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
}

// ログインの入口から戻り先までを通す。戻ってきたところの応答を返す
async function roundTrip(name: 'google' | 'discord', next = '/me') {
  const start = await req(`/login/${name}?next=${encodeURIComponent(next)}`);
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location')!);
  const state = to.searchParams.get('state')!;
  assert.equal(to.searchParams.get('redirect_uri'), `${BASE}/login/${name}/callback`);
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  const cookie = `oauth_${name}=${cookiesOf(start)[`oauth_${name}`]}`;
  const res = await req(`/login/${name}/callback?code=c1&state=${state}`, { cookie });
  return { res, to, cookie, state };
}

test('ログインの画面に、鍵があるものだけ出る', async () => {
  const page = await (await req('/login?next=/me')).text();
  assert.match(page, /href="\/login\/google\?next=%2Fme"/);
  assert.match(page, /Discord でログイン/);
  const bare = createSiteApp({ db, blobs: nodeBlobs(dir), baseUrl: BASE, termsVersion: 3 });
  const none = await (await bare.request(`${BASE}/login`)).text();
  assert.match(none, /ログインの準備中です/);
  assert.equal((await bare.request(`${BASE}/login/google`)).status, 404);
});

test('Google で初めて入ると登録の画面に進み、同意すると利用者ができる', async () => {
  const { res, to } = await roundTrip('google');
  // 求めるのは番号だけで、メールアドレスや名前は求めない
  assert.equal(to.searchParams.get('scope'), 'openid');
  const tokenCall = seen.find((s) => s.url.includes('googleapis'))!;
  const verifierHash = await sha256(tokenCall.body!.get('code_verifier')!);
  assert.equal(to.searchParams.get('code_challenge'), verifierHash);
  assert.equal(tokenCall.body!.get('client_secret'), google.clientSecret);

  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/signup');
  const signup = `signup=${cookiesOf(res).signup}`;
  assert.equal(cookiesOf(res).sid, undefined);
  assert.match(await (await req('/signup', { cookie: signup })).text(), /Googleでログインしました/);

  // 同意しないと作らない
  const no = await req('/signup', { method: 'POST', cookie: signup, body: new URLSearchParams({ name: 'ペンネーム', adult: '1' }) });
  assert.equal(no.status, 400);
  assert.match(await no.text(), /同意が要ります/);
  assert.equal((await db.get<{ n: number }>("select count(*) n from users where provider = 'google'"))!.n, 0);

  const ok = await req('/signup', { method: 'POST', cookie: signup, body: new URLSearchParams({ name: ' ペンネーム ', adult: '1', terms: '1' }) });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get('location'), '/me');
  const sid = cookiesOf(ok).sid;
  assert.ok(sid);
  const u = (await db.get<{ provider_user_id: string; display_name: string; adult: number; terms_version: number }>("select * from users where provider = 'google'"))!;
  assert.deepEqual([u.provider_user_id, u.display_name, u.adult, u.terms_version], ['g-user-1', 'ペンネーム', 1, 3]);
  assert.match(await (await req('/me', { cookie: `sid=${sid}` })).text(), /ペンネーム/);
  // 預かりは使い終わったら消える
  assert.equal((await req('/signup', { cookie: signup })).status, 400);

  // 2回目からは、そのままログインになる
  const again = await roundTrip('google', '/');
  assert.equal(again.res.headers.get('location'), '/');
  assert.ok(cookiesOf(again.res).sid);
});

test('Discord は名前の案を出し、Google の同じ番号とは別の人になる', async () => {
  const { res, to } = await roundTrip('discord');
  assert.equal(to.searchParams.get('scope'), 'identify');
  const signup = `signup=${cookiesOf(res).signup}`;
  assert.match(await (await req('/signup', { cookie: signup })).text(), /value="ディスコの名前"/);
  const ok = await req('/signup', { method: 'POST', cookie: signup, body: new URLSearchParams({ name: 'ディスコの名前', adult: '0', terms: '1' }) });
  assert.equal(ok.status, 302);
  assert.equal((await db.get<{ n: number }>("select count(*) n from users where provider = 'discord' and provider_user_id = 'd-user-1'"))!.n, 1);
});

test('state が合わない、取りやめた、預かりがないときは受け付けない', async () => {
  const start = await req('/login/google');
  const cookie = `oauth_google=${cookiesOf(start).oauth_google}`;
  assert.equal((await req('/login/google/callback?code=c1&state=wrong', { cookie })).status, 400);
  assert.equal((await req('/login/google/callback?code=c1&state=x')).status, 400);
  assert.match(await (await req('/login/google/callback?error=access_denied', { cookie })).text(), /取りやめ/);
  assert.equal((await req('/signup', { method: 'POST', cookie: 'signup=nothing', body: new URLSearchParams({ name: 'a', terms: '1' }) })).status, 400);
  // 戻り先はサイトの中だけ
  googleSub = 'g-user-2';
  const r = await roundTrip('google', 'https://evil.example/');
  const ok = await req('/signup', { method: 'POST', cookie: `signup=${cookiesOf(r.res).signup}`, body: new URLSearchParams({ name: 'b', terms: '1' }) });
  assert.equal(ok.headers.get('location'), '/');
});

test('名前はほかの人と重ならず、運営とまぎらわしい名前も使えない', async () => {
  googleSub = 'g-user-3';
  const { res } = await roundTrip('google');
  const cookie = `signup=${cookiesOf(res).signup}`;
  const tryName = (name: string) => req('/signup', { method: 'POST', cookie, body: new URLSearchParams({ name, terms: '1' }) });
  // 前のテストで「ペンネーム」と「b」ができている。全角半角、大文字小文字、空白の違いは同じと見る
  for (const name of ['ペンネーム', 'ﾍﾟﾝﾈｰﾑ', 'B', 'Ｂ', ' b ']) {
    const r = await tryName(name);
    assert.equal(r.status, 400, name);
    assert.match(await r.text(), /もう使われています/);
  }
  for (const name of ['運営', 'Archsage公式', 'ＡＤＭＩＮ']) {
    const r = await tryName(name);
    assert.equal(r.status, 400, name);
    assert.match(await r.text(), /まぎらわしい/);
  }
  // name_key がない前からの利用者（仮のログインで作った人など）とも重ならない
  await db.run("insert into users (id, provider, provider_user_id, display_name, created_at) values ('old', 'dev', 'Old Name', 'Old Name', 0)");
  assert.equal((await tryName('oldname')).status, 400);
  const ok = await tryName('新しい名前');
  assert.equal(ok.status, 302);
  assert.equal((await db.get<{ name_key: string }>("select name_key from users where provider_user_id = 'g-user-3'"))!.name_key, '新しい名前');
});
