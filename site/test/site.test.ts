import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUNDLE_FORMAT, BUNDLE_VERSION, LOREBOOK_FORMAT, normalizeLorebook, normalizePlot, packBundle, packLorebookBundle, unpackAnyBundle, unpackBundle, type Plot, type PostRef } from '@archsage/shared';
import { hidePost } from '../src/admin.ts';
import { createSiteApp } from '../src/app.ts';
import { nodeBlobs, nodeDb } from '../src/nodeStore.ts';
import { b64url, sha256 } from '../src/util.ts';

const BASE = 'http://site.test';
const dir = mkdtempSync(join(tmpdir(), 'archsage-site-'));
const db = nodeDb(':memory:');
const app = createSiteApp({ db, blobs: nodeBlobs(dir), baseUrl: BASE, termsVersion: 1, devLogin: true, devAdmin: true });

after(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function req(path: string, init: RequestInit & { cookie?: string } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.method && init.method !== 'GET' && !path.startsWith('/api/')) headers.set('origin', BASE);
  return app.request(`${BASE}${path}`, { ...init, headers, redirect: 'manual' });
}

async function login(name: string, adult: boolean, terms = true, admin = false): Promise<string> {
  const res = await req('/login/dev', { method: 'POST', body: new URLSearchParams({ name, adult: adult ? '1' : '0', ...(terms ? { terms: '1' } : {}), ...(admin ? { admin: '1' } : {}), next: '/' }) });
  assert.equal(res.status, 302);
  const sid = /sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1];
  assert.ok(sid);
  return `sid=${sid}`;
}

// アプリの「サイトにつなぐ」と同じ手順で鍵を受け取る
async function connect(cookie: string): Promise<string> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = await sha256(verifier);
  const redirect = 'http://127.0.0.1:47823/site/callback';
  const q = new URLSearchParams({ redirect_uri: redirect, state: 'st1', code_challenge: challenge, code_challenge_method: 'S256' });
  assert.equal((await req(`/connect?${q}`, { cookie })).status, 200);
  const res = await req('/connect', { method: 'POST', cookie, body: new URLSearchParams({ redirect_uri: redirect, state: 'st1', code_challenge: challenge, allow: '1' }) });
  const back = new URL(res.headers.get('location')!);
  assert.equal(back.origin + back.pathname, redirect);
  assert.equal(back.searchParams.get('state'), 'st1');
  const code = back.searchParams.get('code')!;
  // 合鍵が違えば受け取れない
  const wrong = await req('/api/v1/token', { method: 'POST', body: JSON.stringify({ code, code_verifier: 'x', redirect_uri: redirect }) });
  assert.equal(wrong.status, 400);
  // 一度失敗した番号は消えるので、もう一度つなぎ直す
  const res2 = await req('/connect', { method: 'POST', cookie, body: new URLSearchParams({ redirect_uri: redirect, state: 'st2', code_challenge: challenge, allow: '1' }) });
  const code2 = new URL(res2.headers.get('location')!).searchParams.get('code')!;
  const ok = await req('/api/v1/token', { method: 'POST', body: JSON.stringify({ code: code2, code_verifier: verifier, redirect_uri: redirect, label: '自宅のPC' }) });
  assert.equal(ok.status, 200);
  return ((await ok.json()) as { token: string }).token;
}

function pngWithText(): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    new DataView(out.buffer).setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    return out;
  };
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', new Uint8Array(13)), chunk('tEXt', new TextEncoder().encode('prompt\0secret-lora')), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
}

function bundle(title: string, rating: Plot['listing']['rating'] = 'all'): Uint8Array {
  const plot = normalizePlot({
    title,
    story: '放課後の旧校舎',
    characters: [{ id: 'hinata', name: 'ひなた', profile: '元気', avatar: 'images/avatar-hinata.png' } as Plot['characters'][number]],
    intros: [{ text: '扉を開けると' }],
    listing: { tagline: '一言', hashtags: ['学園'], intro: '紹介', creatorComment: '', rating, sourceTitle: '', cover: 'images/cover.png' },
  });
  return packBundle({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: 0, plot, lorebooks: [] }, { 'images/cover.png': pngWithText(), 'images/avatar-hinata.png': pngWithText() });
}

function loreBundle(name: string, rating: Plot['listing']['rating'] = 'all', content = '魔力は月の満ち欠けで強まる'): Uint8Array {
  const lorebook = normalizeLorebook({
    name,
    global: true,
    entries: [{ id: 'e1', keys: ['魔力'], content, constant: false, enabled: true, comment: '魔力' }],
    listing: { tagline: '魔法の決まり', hashtags: ['魔法'], intro: '', creatorComment: '', rating, sourceTitle: '' },
  });
  return packLorebookBundle({ format: LOREBOOK_FORMAT, version: BUNDLE_VERSION, exportedAt: 0, lorebook });
}

async function post(token: string, zip: Uint8Array, meta: object, id?: string) {
  const form = new FormData();
  form.set('bundle', new File([zip as Uint8Array<ArrayBuffer>], 'plot.zip', { type: 'application/zip' }));
  form.set('meta', JSON.stringify(meta));
  return req(id ? `/api/v1/posts/${id}` : '/api/v1/posts', { method: id ? 'PUT' : 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
}

test('つないで投稿し、一覧に出て、アプリで開くと投稿の印つきのzipが届く', async () => {
  const cookie = await login('作者A', false);
  const token = await connect(cookie);
  const me = (await (await req('/api/v1/me', { headers: { authorization: `Bearer ${token}` } })).json()) as { displayName: string };
  assert.equal(me.displayName, '作者A');

  const res = await post(token, bundle('放課後'), { visibility: 'public' });
  assert.equal(res.status, 200);
  const { post: ref, url } = (await res.json()) as { post: PostRef; url: string };
  assert.equal(ref.site, BASE);
  assert.equal(url, `${BASE}/s/${ref.postId}`);

  const list = await (await req('/')).text();
  assert.match(list, /放課後/);
  const page = await req(`/s/${ref.postId}`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /扉を開けると/);
  // 画像に埋め込まれた生成の設定は消えている
  const cover = new Uint8Array(await (await req(`/s/${ref.postId}/cover`)).arrayBuffer());
  assert.equal(new TextDecoder().decode(cover).includes('secret-lora'), false);

  const open = await req(`/s/${ref.postId}/open`);
  assert.equal(open.headers.get('location'), `archsage://open?post=${ref.postId}`);
  const got = await req('/api/v1/bundles', { method: 'POST', body: JSON.stringify({ postId: ref.postId }) });
  assert.equal(got.status, 200);
  const { json } = unpackBundle(new Uint8Array(await got.arrayBuffer()));
  assert.deepEqual(json.plot.posted, ref);
  assert.equal(json.plot.origin, undefined);
  assert.match(await (await req(`/s/${ref.postId}`)).text(), /アプリで開いた回数: 1/);

  // 更新は上書き。他人は更新できない
  const upd = await post(token, bundle('放課後・改'), { visibility: 'unlisted' }, ref.postId);
  assert.equal(upd.status, 200);
  assert.doesNotMatch(await (await req('/')).text(), /放課後・改/); // URLを知る人だけは一覧に出ない
  assert.match(await (await req(`/s/${ref.postId}`)).text(), /放課後・改/);
  const other = await connect(await login('作者B', false));
  assert.equal((await post(other, bundle('乗っ取り'), { visibility: 'public' }, ref.postId)).status, 403);
});

test('手直しの投稿は元を表示し、元が取り下げられるとその旨を出す', async () => {
  const a = await connect(await login('作者A', false));
  const b = await connect(await login('作者B', false));
  const orig = ((await (await post(a, bundle('原作'), { visibility: 'public' })).json()) as { post: PostRef }).post;
  const remix = ((await (await post(b, bundle('手直し版'), { visibility: 'public', originPostId: orig.postId })).json()) as { post: PostRef }).post;
  assert.match(await (await req(`/s/${remix.postId}`)).text(), new RegExp(`/s/${orig.postId}`));
  // 自分の投稿を元にしても、手直しとは扱わない
  const self = ((await (await post(a, bundle('自分の続き'), { visibility: 'public', originPostId: orig.postId })).json()) as { post: PostRef }).post;
  assert.doesNotMatch(await (await req(`/s/${self.postId}`)).text(), /元のシナリオ/);

  assert.equal((await req(`/api/v1/posts/${orig.postId}`, { method: 'DELETE', headers: { authorization: `Bearer ${a}` } })).status, 200);
  assert.equal((await req(`/s/${orig.postId}`)).status, 410);
  assert.match(await (await req(`/s/${remix.postId}`)).text(), /元のシナリオは取り下げられました/);
  const mine = (await (await req('/api/v1/me/posts', { headers: { authorization: `Bearer ${a}` } })).json()) as { posts: { id: string; status: string }[] };
  assert.equal(mine.posts.find((p) => p.id === orig.postId)?.status, 'withdrawn');
});

test('R-18: 投稿の条件、見られる人、引換券は1回だけ', async () => {
  const minor = await connect(await login('未成年', false));
  assert.equal((await post(minor, bundle('大人向け', 'r18'), { visibility: 'public', imagesChecked: true })).status, 403);
  const adultCookie = await login('大人', true);
  const adult = await connect(adultCookie);
  assert.equal((await post(adult, bundle('大人向け', 'r18'), { visibility: 'public' })).status, 400); // 画像の確かめがない
  const ref = ((await (await post(adult, bundle('大人向け', 'r18'), { visibility: 'public', imagesChecked: true })).json()) as { post: PostRef }).post;

  // ログインしていない人、表示をオンにしていない人には見せない
  assert.equal((await req(`/s/${ref.postId}`)).status, 403);
  assert.equal((await req(`/s/${ref.postId}/cover`)).status, 404);
  assert.equal((await req(`/s/${ref.postId}`, { cookie: adultCookie })).status, 403);
  assert.doesNotMatch(await (await req('/', { cookie: adultCookie })).text(), /大人向け/);
  await req('/me/settings', { method: 'POST', cookie: adultCookie, body: new URLSearchParams({ adult: '1', showAdult: '1' }) });
  assert.equal((await req(`/s/${ref.postId}`, { cookie: adultCookie })).status, 200);
  assert.match(await (await req('/', { cookie: adultCookie })).text(), /大人向け/);

  // 引換券なしでは受け取れない。引換券は1回だけ
  assert.equal((await req('/api/v1/bundles', { method: 'POST', body: JSON.stringify({ postId: ref.postId }) })).status, 403);
  const open = await req(`/s/${ref.postId}/open`, { cookie: adultCookie });
  const ticket = new URL(open.headers.get('location')!.replace('archsage://', 'http://x/')).searchParams.get('ticket')!;
  assert.ok(ticket);
  assert.equal((await req('/api/v1/bundles', { method: 'POST', body: JSON.stringify({ postId: ref.postId, ticket }) })).status, 200);
  assert.equal((await req('/api/v1/bundles', { method: 'POST', body: JSON.stringify({ postId: ref.postId, ticket }) })).status, 403);
});

test('規約に同意していないと投稿できず、鍵を無効にすると使えない', async () => {
  const token = await connect(await login('新人', false, false));
  const res = await post(token, bundle('はじめて'), { visibility: 'public' });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: { code: string } }).error.code, 'terms');
  const auth = { authorization: `Bearer ${token}` };
  assert.equal((await req('/api/v1/me/terms', { method: 'POST', headers: auth, body: JSON.stringify({ termsVersion: 1 }) })).status, 200);
  assert.equal((await post(token, bundle('はじめて'), { visibility: 'public' })).status, 200);
  assert.equal((await req('/api/v1/token', { method: 'DELETE', headers: auth })).status, 200);
  assert.equal((await req('/api/v1/me', { headers: auth })).status, 401);
});

test('届いたzipは信用しない: 知らないファイル、画像でない画像、運営による非公開', async () => {
  const cookie = await login('作者C', false);
  const token = await connect(cookie);
  const plot = normalizePlot({ title: '偽物', characters: [{ id: 'a', name: 'a', avatar: 'images/a.png' } as Plot['characters'][number]], intros: [{ text: 'x' }] });
  const fake = packBundle({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: 0, plot, lorebooks: [] }, { 'images/a.png': new TextEncoder().encode('<script>') });
  const res = await post(token, fake, { visibility: 'public' });
  assert.equal(res.status, 400);
  assert.match(((await res.json()) as { error: { message: string } }).error.message, /画像として読めない/);

  const ref = ((await (await post(token, bundle('通報される'), { visibility: 'public' })).json()) as { post: PostRef }).post;
  await hidePost(db, ref.postId, 'レーティングの誤り');
  assert.equal((await req(`/s/${ref.postId}`)).status, 404);
  assert.match(await (await req(`/s/${ref.postId}`, { cookie })).text(), /レーティングの誤り/);
  // ほかのサイトからのフォームの送信は断る
  const evil = await app.request(`${BASE}/me/settings`, { method: 'POST', headers: { origin: 'https://evil.example', cookie }, body: new URLSearchParams({ adult: '1' }) });
  assert.equal(evil.status, 403);
});

test('運営: 通報を見て非公開にし、作者に理由が見え、戻せる。運営でない人には画面がない', async () => {
  const authorCookie = await login('作者D', false);
  const token = await connect(authorCookie);
  const ref = ((await (await post(token, bundle('問題作'), { visibility: 'public' })).json()) as { post: PostRef }).post;
  await req(`/s/${ref.postId}/report`, { method: 'POST', body: new URLSearchParams({ kind: 'rating', detail: '性的な導入がある' }) });
  await req(`/s/${ref.postId}/report`, { method: 'POST', body: new URLSearchParams({ kind: 'other', detail: '同じ件' }) });

  assert.equal((await req('/admin', { cookie: authorCookie })).status, 404);
  assert.equal((await req(`/admin/posts/${ref.postId}/hide`, { method: 'POST', cookie: authorCookie, body: new URLSearchParams({ reason: 'x' }) })).status, 404);

  const staff = await login('運営', true, true, true);
  const page = await (await req('/admin', { cookie: staff })).text();
  assert.match(page, /まだ対応していない通報（2件）/);
  assert.match(page, /性的な導入がある/);
  const reportId = /\/admin\/reports\/([^/]+)\/hide/.exec(page)![1];
  await req(`/admin/reports/${reportId}/hide`, { method: 'POST', cookie: staff, body: new URLSearchParams({ reason: 'R-18にあたる導入があります' }) });

  // 同じ投稿への通報はまとめて閉じる。一覧から消え、作者には理由が見える
  const after = await (await req('/admin', { cookie: staff })).text();
  assert.match(after, /まだ対応していない通報（0件）/);
  assert.match(after, /非公開にした: R-18にあたる導入があります/);
  assert.doesNotMatch(await (await req('/')).text(), /問題作/);
  assert.equal((await req(`/s/${ref.postId}`, { cookie: staff })).status, 200);
  const mine = (await (await req('/api/v1/me/posts', { headers: { authorization: `Bearer ${token}` } })).json()) as { posts: { id: string; status: string; hiddenReason: string }[] };
  assert.deepEqual(
    mine.posts.filter((p) => p.id === ref.postId).map((p) => [p.status, p.hiddenReason]),
    [['hidden', 'R-18にあたる導入があります']],
  );

  // 公開に戻す
  await req(`/admin/posts/${ref.postId}/restore`, { method: 'POST', cookie: staff });
  assert.match(await (await req('/')).text(), /問題作/);

  // 作者の利用を止めると投稿できない。戻すとできる
  const authorId = /\/admin\/users\/([^/]+)\/suspend/.exec(after)![1];
  await req(`/admin/users/${authorId}/suspend`, { method: 'POST', cookie: staff });
  assert.equal((await post(token, bundle('次の作品'), { visibility: 'public' })).status, 403);
  await req(`/admin/users/${authorId}/unsuspend`, { method: 'POST', cookie: staff });
  assert.equal((await post(token, bundle('次の作品'), { visibility: 'public' })).status, 200);

  // 通報がなくても、シナリオのページから非公開にできる
  await req(`/admin/posts/${ref.postId}/hide`, { method: 'POST', cookie: staff, body: new URLSearchParams({ reason: '運営の確認' }) });
  assert.equal((await req(`/s/${ref.postId}`)).status, 404);
});

test('規約とガイドラインのページがある', async () => {
  const terms = await (await req('/terms')).text();
  assert.match(terms, /利用規約/);
  assert.match(terms, /手直しして、このサイトに投稿する/);
  assert.match(await (await req('/guidelines')).text(), /実在し得る児童/);
});

test('設定集だけを投稿でき、シナリオとは別の一覧に出て、中身をページで見せ、アプリで開ける', async () => {
  const token = await connect(await login('設定の作者', false));
  const res = await post(token, loreBundle('月の魔法'), { visibility: 'public' });
  assert.equal(res.status, 200);
  const { post: ref } = (await res.json()) as { post: PostRef };
  assert.match(await (await req('/lorebooks')).text(), /月の魔法/);
  assert.doesNotMatch(await (await req('/')).text(), /月の魔法/);
  const page = await (await req(`/s/${ref.postId}`)).text();
  assert.match(page, /魔力は月の満ち欠けで強まる/);
  assert.match(page, /設定集だけでは遊べません/);

  // アプリで開くと、投稿の印つきの設定集のzipが届く。共通の印は外れている
  const got = await req('/api/v1/bundles', { method: 'POST', body: JSON.stringify({ postId: ref.postId }) });
  const b = unpackAnyBundle(new Uint8Array(await got.arrayBuffer()));
  assert.equal(b.kind, 'lorebook');
  if (b.kind === 'lorebook') {
    assert.deepEqual(b.json.lorebook.posted, ref);
    assert.equal(b.json.lorebook.global, false);
  }
  const mine = (await (await req('/api/v1/me/posts', { headers: { authorization: `Bearer ${token}` } })).json()) as { posts: { id: string; kind: string }[] };
  assert.equal(mine.posts.find((p) => p.id === ref.postId)?.kind, 'lorebook');

  // 種類の違うもので更新はできない。中身のない設定集は投稿できない
  assert.equal((await post(token, bundle('乗り換え'), { visibility: 'public' }, ref.postId)).status, 409);
  assert.equal((await post(token, loreBundle('空', 'all', '  '), { visibility: 'public' })).status, 400);
  // R-18は18歳以上と答えた人だけ。画像がないので、画像の確かめはいらない
  assert.equal((await post(token, loreBundle('夜の決まり', 'r18'), { visibility: 'public' })).status, 403);
  const adult = await connect(await login('大人の作者', true));
  assert.equal((await post(adult, loreBundle('夜の決まり', 'r18'), { visibility: 'public' })).status, 200);
});
