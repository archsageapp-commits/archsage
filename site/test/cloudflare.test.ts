import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BUNDLE_FORMAT, BUNDLE_VERSION, normalizePlot, packBundle, type Plot, type PostRef } from '@archsage/shared';
import type { D1Database, D1PreparedStatement, ImagesBinding, R2Bucket } from '../src/cloudflare.ts';
import { MIGRATIONS, SCHEMA, type Param } from '../src/db.ts';
import { migrate } from '../src/nodeStore.ts';
import worker, { type Env } from '../src/worker.ts';
import { b64url, sha256 } from '../src/util.ts';

// Cloudflare の D1、R2、Images の代わりを node:sqlite と Map で作り、worker.ts を通して動かす

test('D1 に入れる表の定義は、サイトの SCHEMA と同じ', () => {
  const file = readFileSync(join(import.meta.dirname, '..', 'migrations', '0001_init.sql'), 'utf8');
  const body = file.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  assert.equal(body.trim(), SCHEMA.trim());
  // あとから変えた分は、0002 から順に MIGRATIONS と同じ
  MIGRATIONS.forEach((sql, i) => {
    const name = readdirSync(join(import.meta.dirname, '..', 'migrations')).find((f) => f.startsWith(String(i + 2).padStart(4, '0')));
    assert.ok(name, `migrations/${String(i + 2).padStart(4, '0')}_*.sql がありません`);
    const text = readFileSync(join(import.meta.dirname, '..', 'migrations', name), 'utf8');
    assert.equal(text.split('\n').filter((l) => !l.startsWith('--')).join('\n').trim(), sql.trim());
  });
});

function fakeD1(): D1Database {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  migrate(db);
  return {
    prepare(sql: string) {
      let values: Param[] = [];
      const st: D1PreparedStatement = {
        bind: (...v) => ((values = v), st),
        run: async () => db.prepare(sql).run(...values),
        first: async <T>() => (db.prepare(sql).get(...values) as T | undefined) ?? null,
        all: async <T>() => ({ results: db.prepare(sql).all(...values) as T[] }),
      };
      return st;
    },
  };
}

// 一覧は2件ずつしか返さない。消すときに続きを取りに行くかを確かめる
function fakeR2(): R2Bucket & { keys(): string[] } {
  const m = new Map<string, Uint8Array>();
  return {
    keys: () => [...m.keys()].sort(),
    async put(k, v) {
      m.set(k, v);
    },
    async get(k) {
      const v = m.get(k);
      return v ? { arrayBuffer: async () => v.slice().buffer } : null;
    },
    async list({ prefix, cursor }) {
      const all = [...m.keys()].filter((k) => k.startsWith(prefix)).sort();
      const from = Number(cursor ?? 0);
      const page = all.slice(from, from + 2);
      return { objects: page.map((key) => ({ key })), truncated: from + 2 < all.length, cursor: String(from + 2) };
    },
    async delete(keys) {
      for (const k of keys) m.delete(k);
    },
  };
}

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
function fakeImages(calls: object[]): ImagesBinding {
  return {
    input: () => ({
      transform: (o) => {
        calls.push(o);
        return { output: async () => ({ response: () => new Response(WEBP) }) };
      },
    }),
  };
}

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0]);

test('worker.ts: D1 と R2 に保存し、画像は WebP に作り直し、取り下げでファイルが消える', async () => {
  const calls: object[] = [];
  const blobs = fakeR2();
  const BASE = 'https://site.example';
  const env: Env = { DB: fakeD1(), BLOBS: blobs, IMAGES: fakeImages(calls), BASE_URL: `${BASE}/`, TERMS_VERSION: '1', DEV_LOGIN: '1', DEV_LOGIN_KEY: 'aikotoba' };
  const req = (path: string, init: RequestInit = {}) => Promise.resolve(worker.fetch(new Request(`${BASE}${path}`, { redirect: 'manual', ...init }), env));

  const wrongKey = await req('/login/dev', { method: 'POST', headers: { origin: BASE }, body: new URLSearchParams({ name: '作者', adult: '0', terms: '1', key: 'x' }) });
  assert.equal(wrongKey.status, 403);
  const login = await req('/login/dev', { method: 'POST', headers: { origin: BASE }, body: new URLSearchParams({ name: '作者', adult: '0', terms: '1', key: 'aikotoba' }) });
  const cookie = `sid=${/sid=([^;]+)/.exec(login.headers.get('set-cookie') ?? '')![1]}`;
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const redirect = 'http://127.0.0.1:47823/site/callback';
  const allowed = await req('/connect', { method: 'POST', headers: { origin: BASE, cookie }, body: new URLSearchParams({ redirect_uri: redirect, state: 's', code_challenge: await sha256(verifier), allow: '1' }) });
  const code = new URL(allowed.headers.get('location')!).searchParams.get('code')!;
  const { token } = (await (await req('/api/v1/token', { method: 'POST', body: JSON.stringify({ code, code_verifier: verifier, redirect_uri: redirect }) })).json()) as { token: string };

  const plot = normalizePlot({
    title: '雲の上',
    characters: [{ id: 'a', name: 'a', avatar: 'images/a.png' } as Plot['characters'][number]],
    intros: [{ text: 'はじまり' }],
    listing: { tagline: '', hashtags: [], intro: '', creatorComment: '', rating: 'all', sourceTitle: '', cover: 'images/cover.png' },
  });
  const zip = packBundle({ format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: 0, plot, lorebooks: [] }, { 'images/cover.png': png, 'images/a.png': png });
  const form = new FormData();
  form.set('bundle', new File([zip as Uint8Array<ArrayBuffer>], 'p.zip'));
  form.set('meta', JSON.stringify({ visibility: 'public' }));
  const res = await req('/api/v1/posts', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form });
  assert.equal(res.status, 200);
  const ref = ((await res.json()) as { post: PostRef }).post;
  assert.equal(ref.site, BASE);

  assert.deepEqual(blobs.keys(), [`posts/${ref.postId}/images/avatar-0.webp`, `posts/${ref.postId}/images/cover.webp`, `posts/${ref.postId}/plot.json`]);
  assert.deepEqual(calls, [
    { width: 1024, height: 1536, fit: 'scale-down' },
    { width: 512, height: 512, fit: 'scale-down' },
  ]);
  const cover = await req(`/s/${ref.postId}/cover`);
  assert.equal(cover.headers.get('content-type'), 'image/webp');
  assert.match(await (await req('/')).text(), /雲の上/);

  assert.equal((await req(`/api/v1/posts/${ref.postId}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` } })).status, 200);
  assert.deepEqual(blobs.keys(), []);
});

test('worker.ts: 日本以外からのアクセスは断る', async () => {
  const env: Env = { DB: fakeD1(), BLOBS: fakeR2(), IMAGES: fakeImages([]), BASE_URL: 'https://site.example', ALLOWED_COUNTRIES: 'JP' };
  const from = (country?: string) => {
    const r = new Request('https://site.example/');
    if (country) Object.defineProperty(r, 'cf', { value: { country } });
    return Promise.resolve(worker.fetch(r, env));
  };
  assert.equal((await from('US')).status, 403);
  assert.equal((await from('JP')).status, 200);
  assert.equal((await from()).status, 200);
  // 合言葉がなければ、DEV_LOGIN を 1 にしても仮のログインは出ない
  const noKey: Env = { ...env, DEV_LOGIN: '1' };
  const res = await worker.fetch(new Request('https://site.example/login/dev', { method: 'POST', body: new URLSearchParams({ name: 'x' }) }), noKey);
  assert.equal(res.status, 404);
});
