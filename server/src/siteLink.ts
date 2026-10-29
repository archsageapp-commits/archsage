import { BundleError, newId, normalizeLorebook, stripImageMetadata, unpackAnyBundle, type Lorebook, type Plot, type PostRef, type Rating, type Settings } from '@archsage/shared';
import { exportLorebook, exportPlot, importLorebook, importPlot } from './bundle.ts';
import { HttpError, type Core } from './core.ts';

// 投稿サイトとの通信。画面はサイトと直接話さず、すべてここを通す。アプリの鍵は画面に出さない

const CONNECT_MINUTES = 10;
const OPEN_MINUTES = 10;

export interface SitePost {
  id: string;
  kind: 'plot' | 'lorebook';
  title: string;
  status: 'live' | 'hidden' | 'withdrawn';
  visibility: 'public' | 'unlisted';
  rating: Rating;
  hiddenReason: string | null;
  updatedAt: number;
  url: string;
}

export interface PostOptions {
  visibility: 'public' | 'unlisted';
  rating: Rating;
  sourceTitle: string;
  imagesChecked: boolean;
  target: 'new' | 'update'; // 出どころが自分の投稿のとき、元の投稿を更新するか
}

export interface OpenPreview {
  key: string;
  kind: 'plot' | 'lorebook';
  entries?: number; // 設定集の項目の数
  title: string;
  authorName: string;
  rating: Rating;
  tagline: string;
  cover?: string; // data URL
}

// 合鍵（PKCE の code_verifier）と、受け取ったzipは少しの間だけ手元に持つ
const connects = new Map<string, { verifier: string; redirect: string; site: string; expires: number }>();
const opens = new Map<string, { bytes: Uint8Array; expires: number }>();

function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function sha256(text: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

function sweep<T extends { expires: number }>(m: Map<string, T>): void {
  const now = Date.now();
  for (const [k, v] of m) if (v.expires < now) m.delete(k);
}

export class SiteLink {
  private readonly core: Core;
  constructor(core: Core) {
    this.core = core;
  }

  private settings(): Settings {
    return this.core.store.getSettings();
  }

  private connected(): { site: string; token: string; user: { id: string; displayName: string } } {
    const s = this.settings().site;
    if (!s.token || !s.user) throw new HttpError(401, '先に設定の「投稿サイト」で、サイトと連携してください');
    return { site: s.url, token: s.token, user: s.user };
  }

  private async call(path: string, init: RequestInit = {}, auth = true): Promise<Response> {
    const site = this.settings().site.url;
    const headers = new Headers(init.headers);
    if (auth) headers.set('authorization', `Bearer ${this.connected().token}`);
    let res: Response;
    try {
      res = await fetch(`${site}/api/v1${path}`, { ...init, headers, signal: AbortSignal.timeout(60_000) });
    } catch {
      throw new HttpError(502, `投稿サイトにつながりませんでした（${site}）`);
    }
    if (res.ok) return res;
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
    // 鍵が無効になっていたら、手元のつながりも外す
    if (res.status === 401 && auth) this.forget();
    const err = new HttpError(res.status === 401 ? 401 : res.status >= 500 ? 502 : 400, body.error?.message ?? `投稿サイトがエラーを返しました（${res.status}）`);
    (err as HttpError & { code?: string }).code = body.error?.code;
    throw err;
  }

  private forget(): void {
    const s = this.settings();
    s.site = { url: s.site.url };
    this.core.store.putSettings(s);
  }

  // ---- つなぐ ----
  async beginConnect(port: string): Promise<{ authorizeUrl: string }> {
    sweep(connects);
    const site = this.settings().site.url;
    const state = b64url(crypto.getRandomValues(new Uint8Array(24)));
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const redirect = `http://127.0.0.1:${port}/site/callback`;
    connects.set(state, { verifier, redirect, site, expires: Date.now() + CONNECT_MINUTES * 6e4 });
    const q = new URLSearchParams({ redirect_uri: redirect, state, code_challenge: await sha256(verifier), code_challenge_method: 'S256' });
    return { authorizeUrl: `${site}/connect?${q}` };
  }

  async finishConnect(state: string, code: string | undefined, error: string | undefined): Promise<string> {
    const p = connects.get(state);
    connects.delete(state);
    if (!p || p.expires < Date.now()) throw new HttpError(400, '連携の手続きの期限が切れています。アプリでもう一度「サイトと連携する」を押してください');
    if (error || !code) throw new HttpError(400, '連携をやめました');
    if (p.site !== this.settings().site.url) throw new HttpError(400, '途中でサイトの URL が変わりました。もう一度連携してください');
    const res = await this.call('/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, code_verifier: p.verifier, redirect_uri: p.redirect, label: 'Archsage' }) }, false);
    const { token, user } = (await res.json()) as { token: string; user: { id: string; displayName: string } };
    const s = this.settings();
    s.site = { url: s.site.url, token, user };
    this.core.store.putSettings(s);
    return user.displayName;
  }

  async disconnect(): Promise<void> {
    if (this.settings().site.token) await this.call('/token', { method: 'DELETE' }).catch(() => undefined);
    this.forget();
  }

  // ---- 投稿の画面で使う ----
  async account(): Promise<{ termsVersion: number; currentTermsVersion: number; termsUrl: string; adult: boolean; displayName: string }> {
    const me = (await (await this.call('/me')).json()) as { displayName: string; adult: boolean; termsVersion: number; currentTermsVersion: number };
    return { ...me, termsUrl: `${this.settings().site.url}/terms` };
  }

  async agreeTerms(termsVersion: number): Promise<void> {
    await this.call('/me/terms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ termsVersion }) });
  }

  // 自分の投稿の状態を取り、サイトで取り下げられたものは手元の印を外す
  async myPosts(): Promise<SitePost[]> {
    const s = this.settings().site;
    if (!s.token || !s.user) return [];
    const { posts } = (await (await this.call('/me/posts')).json()) as { posts: SitePost[] };
    const live = new Map(posts.filter((p) => p.status !== 'withdrawn').map((p) => [p.id, p]));
    for (const plot of this.core.store.plots.list()) {
      if (plot.posted && this.isMine(plot.posted) && !live.has(plot.posted.postId)) this.core.store.plots.put({ ...plot, posted: undefined });
    }
    for (const book of this.core.store.lorebooks.list()) {
      if (book.posted && this.isMine(book.posted) && !live.has(book.posted.postId)) this.core.store.lorebooks.put({ ...book, posted: undefined });
    }
    return posts.filter((p) => p.status !== 'withdrawn');
  }

  private isMine(ref: PostRef): boolean {
    const s = this.settings().site;
    return ref.site === s.url && ref.authorId === s.user?.id;
  }

  // 画面から来る値は欠けていることがある（元作品名の欄を足す前のシナリオなど）ので、ここで形をそろえる
  private options(input: Partial<PostOptions>): PostOptions {
    return {
      visibility: input.visibility === 'unlisted' ? 'unlisted' : 'public',
      rating: input.rating === 'r18' || input.rating === 'r18g' ? input.rating : 'all',
      sourceTitle: typeof input.sourceTitle === 'string' ? input.sourceTitle : '',
      imagesChecked: input.imagesChecked === true,
      target: input.target === 'update' ? 'update' : 'new',
    };
  }

  // zipを送る。自分の投稿の印があればその投稿を、出どころが自分の投稿で「元の投稿を更新」ならそちらを更新する
  private async upload(zip: Uint8Array, item: { posted?: PostRef; origin?: PostRef }, o: PostOptions): Promise<{ post: PostRef; url: string }> {
    const { user } = this.connected();
    const updateId = item.posted && this.isMine(item.posted) ? item.posted.postId : o.target === 'update' && item.origin && this.isMine(item.origin) ? item.origin.postId : undefined;
    const origin = item.origin && item.origin.site === this.settings().site.url && item.origin.authorId !== user.id ? item.origin.postId : undefined;
    const form = new FormData();
    form.set('bundle', new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), 'bundle.zip');
    form.set('meta', JSON.stringify({ visibility: o.visibility, originPostId: origin, imagesChecked: o.imagesChecked }));
    const res = await this.call(updateId ? `/posts/${updateId}` : '/posts', { method: updateId ? 'PUT' : 'POST', body: form });
    return (await res.json()) as { post: PostRef; url: string };
  }

  // 取り下げる。すでに取り下げられていれば、手元の印を外すだけでよい
  private async remove(posted: PostRef | undefined, what: string): Promise<void> {
    if (!posted || !this.isMine(posted)) throw new HttpError(400, `この${what}は、連携しているサイトに投稿されていません`);
    try {
      await this.call(`/posts/${posted.postId}`, { method: 'DELETE' });
    } catch (e) {
      if (!(e instanceof HttpError && (e as HttpError & { code?: string }).code === 'not_found')) throw e;
    }
  }

  async post(plotId: string, input: Partial<PostOptions>): Promise<{ plot: Plot; url: string }> {
    const o = this.options(input);
    let plot = this.core.plotOf(plotId);
    // 投稿の画面で選んだレーティングと元作品名は、手元のシナリオにも書き戻す
    plot = this.core.store.plots.put({ ...plot, listing: { ...plot.listing, rating: o.rating, sourceTitle: o.sourceTitle.trim() }, updatedAt: Date.now() });
    const { post, url } = await this.upload(exportPlot(this.core, plot.id), plot, o);
    plot = this.core.store.plots.put({ ...this.core.plotOf(plot.id), posted: post });
    return { plot, url };
  }

  async withdraw(plotId: string): Promise<Plot> {
    const plot = this.core.plotOf(plotId);
    await this.remove(plot.posted, 'シナリオ');
    return this.core.store.plots.put({ ...plot, posted: undefined });
  }

  private lorebookOf(id: string): Lorebook {
    const b = this.core.store.lorebooks.get(id);
    if (!b) throw new HttpError(404, '設定集が見つかりません');
    return normalizeLorebook(b);
  }

  // 設定集だけで投稿する。画像はないので、画像の確かめはいらない
  async postLorebook(lorebookId: string, input: Partial<PostOptions>): Promise<{ lorebook: Lorebook; url: string }> {
    const o = { ...this.options(input), imagesChecked: false };
    let book = this.lorebookOf(lorebookId);
    book = this.core.store.lorebooks.put({ ...book, listing: { ...book.listing!, rating: o.rating, sourceTitle: o.sourceTitle.trim() } });
    const { post, url } = await this.upload(exportLorebook(this.core, book.id), book, o);
    book = this.core.store.lorebooks.put({ ...this.lorebookOf(book.id), posted: post });
    return { lorebook: book, url };
  }

  async withdrawLorebook(lorebookId: string): Promise<Lorebook> {
    const book = this.lorebookOf(lorebookId);
    await this.remove(book.posted, '設定集');
    return this.core.store.lorebooks.put({ ...book, posted: undefined });
  }

  // ---- アプリで開く ----
  // リンクの中身は信用しない。番号の形だけ確かめ、受け取り先は設定にあるサイトに限る
  async open(postId: string, ticket: string | undefined): Promise<OpenPreview> {
    if (!/^[a-z0-9]{1,32}$/.test(postId) || (ticket !== undefined && !/^[A-Za-z0-9_-]{1,128}$/.test(ticket))) throw new HttpError(400, 'リンクの形が正しくありません');
    sweep(opens);
    const res = await this.call('/bundles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postId, ticket }) }, false);
    const bytes = new Uint8Array(await res.arrayBuffer());
    let json: ReturnType<typeof unpackAnyBundle>;
    try {
      json = unpackAnyBundle(bytes);
    } catch (e) {
      if (e instanceof BundleError) throw new HttpError(400, e.message);
      throw e;
    }
    const key = newId();
    opens.set(key, { bytes, expires: Date.now() + OPEN_MINUTES * 6e4 });
    if (json.kind === 'lorebook') {
      const book = normalizeLorebook(json.json.lorebook);
      return { key, kind: 'lorebook', title: book.name, authorName: book.posted?.authorName ?? '', rating: book.listing!.rating, tagline: book.listing!.tagline, entries: book.entries.length };
    }
    const plot = json.json.plot;
    const coverBytes = plot.listing?.cover ? json.images[plot.listing.cover] : undefined;
    return {
      key,
      kind: 'plot',
      title: plot.title ?? '',
      authorName: plot.posted?.authorName ?? '',
      rating: plot.listing?.rating ?? 'all',
      tagline: plot.listing?.tagline ?? '',
      cover: coverBytes ? `data:${coverType(coverBytes)};base64,${Buffer.from(stripImageMetadata(coverBytes)).toString('base64')}` : undefined,
    };
  }

  importOpened(key: string): { plot: Plot } | { lorebook: Lorebook } {
    const o = opens.get(key);
    opens.delete(key);
    if (!o || o.expires < Date.now()) throw new HttpError(400, '受け取ったものの期限が切れました。サイトでもう一度「アプリで開く」を押してください');
    // 中身を見て、シナリオか設定集として取り込む
    let kind: 'plot' | 'lorebook';
    try {
      kind = unpackAnyBundle(o.bytes).kind;
    } catch (e) {
      if (e instanceof BundleError) throw new HttpError(400, e.message);
      throw e;
    }
    return kind === 'lorebook' ? { lorebook: importLorebook(this.core, o.bytes) } : { plot: importPlot(this.core, o.bytes) };
  }
}

function coverType(b: Uint8Array): string {
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x52 && b[1] === 0x49) return 'image/webp';
  return 'image/png';
}
