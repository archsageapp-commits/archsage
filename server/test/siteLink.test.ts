import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import type { Lorebook, Plot, Settings } from '@archsage/shared';
import { createApp } from '../src/app.ts';
import { createSiteApp } from '../../site/src/app.ts';
import { nodeBlobs, nodeDb } from '../../site/src/nodeStore.ts';

// アプリと仮の投稿サイトを通しで動かす。サイトは本当に待ち受け、アプリの手元のサーバーはそこへ話しかける
const root = resolve(import.meta.dirname, '..', '..');
const appDir = mkdtempSync(join(tmpdir(), 'archsage-link-app-'));
const siteDir = mkdtempSync(join(tmpdir(), 'archsage-link-site-'));
const siteDb = nodeDb(':memory:');
let siteBase = '';
const siteServer = await new Promise<ReturnType<typeof serve>>((done) => {
  const s = serve({ fetch: (req) => siteApp.fetch(req), hostname: '127.0.0.1', port: 0 }, () => done(s));
});
siteBase = `http://127.0.0.1:${(siteServer.address() as AddressInfo).port}`;
const siteApp = createSiteApp({ db: siteDb, blobs: nodeBlobs(siteDir), baseUrl: siteBase, termsVersion: 1, devLogin: true });
const ctx = createApp({ paths: { dataDir: appDir, webDir: join(root, 'web', 'dist'), assetsDir: join(root, 'assets') } });
// 画面を開いているのは Electron の窓と同じポート、という前提で呼ぶ
const APP = 'http://127.0.0.1:47823';

after(() => {
  siteServer.close();
  siteDb.close();
  ctx.db.close();
  rmSync(appDir, { recursive: true, force: true });
  rmSync(siteDir, { recursive: true, force: true });
});

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await ctx.app.request(`${APP}/api${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

// ブラウザの代わり。サイトのログインの記録（Cookie）を持って歩く
async function browser(name: string, terms: boolean) {
  const res = await fetch(`${siteBase}/login/dev`, { method: 'POST', redirect: 'manual', headers: { origin: siteBase }, body: new URLSearchParams({ name, adult: '0', ...(terms ? { terms: '1' } : {}) }) });
  const cookie = `sid=${/sid=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`;
  return (url: string, init: RequestInit = {}) => fetch(url, { ...init, redirect: 'manual', headers: { ...(init.headers ?? {}), cookie, ...(init.method === 'POST' ? { origin: siteBase } : {}) } });
}

test('アプリからサイトにつなぎ、投稿し、更新し、アプリで開いて取り込み、取り下げる', async () => {
  await call('PUT', '/settings', { site: { url: siteBase } });

  // つなぐ: アプリが開くURLをブラウザで開き、許可すると、ブラウザがアプリに戻る
  const { authorizeUrl } = await call<{ authorizeUrl: string }>('POST', '/site/connect');
  const go = await browser('作者A', false);
  assert.equal((await go(authorizeUrl)).status, 200);
  const q = new URL(authorizeUrl).searchParams;
  const allowed = await go(`${siteBase}/connect`, { method: 'POST', body: new URLSearchParams({ redirect_uri: q.get('redirect_uri')!, state: q.get('state')!, code_challenge: q.get('code_challenge')!, allow: '1' }) });
  const back = allowed.headers.get('location')!;
  assert.ok(back.startsWith(`${APP}/site/callback?`));
  const done = await ctx.app.request(back);
  assert.match(await done.text(), /作者A として連携しました/);
  const s = await call<Settings>('GET', '/settings');
  assert.equal(s.site.connected, true);
  assert.equal(s.site.token, undefined);

  // 規約に同意していなければ、同意してから投稿する
  const account = await call<{ termsVersion: number; currentTermsVersion: number }>('GET', '/site/account');
  assert.equal(account.termsVersion, 0);
  const plot = await call<Plot>('POST', '/plots', { title: '放課後', characters: [{ name: 'ひなた', profile: '元気' }], intros: [{ text: '扉を開けると' }] });
  const opts = { visibility: 'public', rating: 'all', sourceTitle: '元の作品', imagesChecked: false, target: 'new' };
  // 元作品名の欄を足す前に保存したシナリオでも投稿できる
  const old = ctx.store.plots.list().find((p) => p.id === plot.id)!;
  const { sourceTitle: _drop, ...listing } = old.listing;
  ctx.store.plots.put({ ...old, listing: listing as Plot['listing'] });
  await assert.rejects(call('POST', `/plots/${plot.id}/post`, opts), /規約/);
  await call('POST', '/site/terms', { termsVersion: account.currentTermsVersion });
  const bare = await call<{ plot: Plot; url: string }>('POST', `/plots/${plot.id}/post`, { visibility: 'public', rating: 'all', imagesChecked: false, target: 'new' });
  assert.equal(bare.plot.listing.sourceTitle, '');
  const first = await call<{ plot: Plot; url: string }>('POST', `/plots/${plot.id}/post`, opts);
  assert.equal(first.plot.posted?.site, siteBase);
  assert.equal(first.plot.listing.sourceTitle, '元の作品');
  assert.equal(first.plot.posted?.postId, bare.plot.posted?.postId);
  assert.equal((await fetch(first.url)).status, 200);

  // 2回目は更新になり、同じ投稿のまま
  const second = await call<{ plot: Plot }>('POST', `/plots/${plot.id}/post`, { ...opts, visibility: 'unlisted' });
  assert.equal(second.plot.posted?.postId, first.plot.posted?.postId);
  const mine = await call<{ posts: { id: string; visibility: string }[] }>('GET', '/site/posts');
  assert.deepEqual(mine.posts.map((p) => [p.id, p.visibility]), [[first.plot.posted!.postId, 'unlisted']]);

  // アプリで開く: サイトのリンクから番号を読み、確認してから取り込む
  const link = (await go(`${siteBase}/s/${first.plot.posted!.postId}/open`)).headers.get('location')!;
  const postId = new URL(link.replace('archsage://', 'http://x/')).searchParams.get('post')!;
  const preview = await call<{ key: string; title: string; authorName: string }>('POST', '/site/open', { post: postId });
  assert.equal(preview.title, '放課後');
  assert.equal(preview.authorName, '作者A');
  const { plot: imported } = await call<{ plot: Plot }>('POST', `/site/open/${preview.key}`);
  assert.equal(imported.posted, undefined);
  assert.equal(imported.origin?.postId, postId);
  await assert.rejects(call('POST', `/site/open/${preview.key}`), /期限/); // 一度きり
  await assert.rejects(call('POST', '/site/open', { post: '../evil' }), /リンクの形/);

  // 取り下げると手元の印が外れ、サイトでは見られなくなる
  const withdrawn = await call<Plot>('POST', `/plots/${plot.id}/withdraw`);
  assert.equal(withdrawn.posted, undefined);
  assert.equal((await fetch(first.url)).status, 410);

  await call('POST', '/site/disconnect');
  assert.equal((await call<Settings>('GET', '/settings')).site.connected, false);
  await assert.rejects(call('GET', '/site/account'), /連携してください/);
});

test('サイトで取り下げた投稿は、アプリの印も外れる。URL を変えると連携は外れる', async () => {
  const { authorizeUrl } = await call<{ authorizeUrl: string }>('POST', '/site/connect');
  const go = await browser('作者B', true);
  const q = new URL(authorizeUrl).searchParams;
  const back = (await go(`${siteBase}/connect`, { method: 'POST', body: new URLSearchParams({ redirect_uri: q.get('redirect_uri')!, state: q.get('state')!, code_challenge: q.get('code_challenge')!, allow: '1' }) })).headers.get('location')!;
  await ctx.app.request(back);
  const plot = await call<Plot>('POST', '/plots', { title: '雨宿り', characters: [{ name: '店主' }], intros: [{ text: '雨の日に' }] });
  const { plot: posted } = await call<{ plot: Plot }>('POST', `/plots/${plot.id}/post`, { visibility: 'public', rating: 'all', sourceTitle: '', imagesChecked: false, target: 'new' });
  await go(`${siteBase}/me/posts/${posted.posted!.postId}/withdraw`, { method: 'POST' });
  assert.deepEqual((await call<{ posts: unknown[] }>('GET', '/site/posts')).posts, []);
  assert.equal((await call<Plot>('GET', `/plots/${plot.id}`)).posted, undefined);

  // 設定集だけを投稿し、アプリで開くと設定集として取り込む。サイトで取り下げると印が外れる
  const book = await call<Lorebook>('POST', '/lorebooks', { name: '雨の町', global: true, entries: [{ keys: ['雨'], content: '町はいつも雨' }], listing: { tagline: '雨の決まり' } });
  const lp = await call<{ lorebook: Lorebook; url: string }>('POST', `/lorebooks/${book.id}/post`, { visibility: 'public', rating: 'all', sourceTitle: '', imagesChecked: false, target: 'new' });
  assert.match(await (await fetch(lp.url)).text(), /町はいつも雨/);
  const pv = await call<{ key: string; kind: string; entries: number; title: string }>('POST', '/site/open', { post: lp.lorebook.posted!.postId });
  assert.deepEqual([pv.kind, pv.entries, pv.title], ['lorebook', 1, '雨の町']);
  const { lorebook: got } = await call<{ lorebook: Lorebook }>('POST', `/site/open/${pv.key}`);
  assert.notEqual(got.id, book.id);
  assert.deepEqual([got.name, got.global, got.posted, got.origin?.postId, got.entries[0].content], ['雨の町', false, undefined, lp.lorebook.posted!.postId, '町はいつも雨']);
  // シナリオの取り込みに、設定集のzipは使えない
  const zip = new Uint8Array(await (await ctx.app.request(`${APP}/api/lorebooks/${book.id}/export`)).arrayBuffer());
  const wrong = await ctx.app.request(`${APP}/api/plots/import`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip });
  assert.match(await wrong.text(), /設定集のzip/);
  // 設定集の画面から取り込むと、共通にはせず別の設定集として入る
  const fromFile = (await (await ctx.app.request(`${APP}/api/lorebooks/import`, { method: 'POST', headers: { 'content-type': 'application/zip' }, body: zip })).json()) as Lorebook;
  assert.deepEqual([fromFile.name, fromFile.global, fromFile.posted], ['雨の町', false, undefined]);
  await go(`${siteBase}/me/posts/${lp.lorebook.posted!.postId}/withdraw`, { method: 'POST' });
  assert.deepEqual((await call<{ posts: unknown[] }>('GET', '/site/posts')).posts, []);
  assert.equal((await call<Lorebook[]>('GET', '/lorebooks')).find((b) => b.id === book.id)?.posted, undefined);

  await call('PUT', '/settings', { site: { url: 'http://127.0.0.1:1' } });
  assert.equal((await call<Settings>('GET', '/settings')).site.connected, false);
});
