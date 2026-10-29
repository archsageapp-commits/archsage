import {
  BUNDLE_FORMAT,
  BUNDLE_LIMITS,
  BUNDLE_VERSION,
  BundleError,
  LOREBOOK_FORMAT,
  newId,
  normalizeLorebook,
  normalizePlot,
  packBundle,
  packLorebookBundle,
  unpackAnyBundle,
  type BundleJson,
  type Lorebook,
  type LorebookBundleJson,
  type Plot,
  type PostRef,
  type Rating,
} from '@archsage/shared';
import type { Blobs, Db } from './db.ts';
import { AVATAR_FIT, COVER_FIT, type ImageFit, type ImageProcessor } from './images.ts';
import { sha256 } from './util.ts';

export interface UserRow {
  id: string;
  provider: string;
  provider_user_id: string;
  display_name: string;
  adult: number;
  show_adult: number;
  terms_version: number;
  admin: number;
  created_at: number;
  suspended_at: number | null;
}

export type PostKind = 'plot' | 'lorebook';

export interface PostRow {
  id: string;
  kind: PostKind;
  author_id: string;
  title: string;
  tagline: string;
  intro: string;
  creator_comment: string;
  hashtags: string;
  source_title: string;
  rating: Rating;
  has_cover: number;
  visibility: 'public' | 'unlisted';
  status: 'live' | 'hidden' | 'withdrawn';
  hidden_reason: string | null;
  origin_post_id: string | null;
  bundle_version: number;
  content_hash: string;
  opens: number;
  created_at: number;
  updated_at: number;
}

export interface PostMeta {
  visibility: 'public' | 'unlisted';
  originPostId?: string;
  imagesChecked?: boolean; // R-18のとき、画像の修正を確かめたか
}

// 投稿の中身の上限。zipの大きさは shared の BUNDLE_LIMITS
export const TEXT_LIMITS = { title: 100, tagline: 200, intro: 5000, creatorComment: 2000, hashtags: 20, hashtag: 30, sourceTitle: 100, loreEntries: 500, loreKeys: 30, loreKey: 100, loreContent: 10000 };

export class PostError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly code: string;
  constructor(status: 400 | 403 | 404 | 409, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const isAdultRating = (r: Rating) => r !== 'all';

const over = (v: string, n: number) => v.length > n;

// 紹介の欄はシナリオと設定集で同じ
function checkListing(title: string, l: Pick<Plot['listing'], 'tagline' | 'intro' | 'creatorComment' | 'sourceTitle' | 'hashtags'>): void {
  if (!title.trim()) throw new PostError(400, 'invalid', '題名がありません');
  if (over(title, TEXT_LIMITS.title)) throw new PostError(400, 'invalid', `題名は${TEXT_LIMITS.title}文字までです`);
  if (over(l.tagline, TEXT_LIMITS.tagline)) throw new PostError(400, 'invalid', `一言紹介は${TEXT_LIMITS.tagline}文字までです`);
  if (over(l.intro, TEXT_LIMITS.intro)) throw new PostError(400, 'invalid', `紹介文は${TEXT_LIMITS.intro}文字までです`);
  if (over(l.creatorComment, TEXT_LIMITS.creatorComment)) throw new PostError(400, 'invalid', `作者コメントは${TEXT_LIMITS.creatorComment}文字までです`);
  if (over(l.sourceTitle, TEXT_LIMITS.sourceTitle)) throw new PostError(400, 'invalid', `元作品名は${TEXT_LIMITS.sourceTitle}文字までです`);
  if (l.hashtags.length > TEXT_LIMITS.hashtags || l.hashtags.some((t) => typeof t !== 'string' || over(t, TEXT_LIMITS.hashtag))) {
    throw new PostError(400, 'invalid', `ハッシュタグは${TEXT_LIMITS.hashtags}個まで、1つ${TEXT_LIMITS.hashtag}文字までです`);
  }
}

function checkText(plot: Plot): void {
  checkListing(plot.title, plot.listing);
  if (plot.characters.length === 0) throw new PostError(400, 'invalid', 'キャラクターがいません');
  if (!plot.intros.some((i) => i.text.trim())) throw new PostError(400, 'invalid', '導入がありません');
}

function checkLorebook(book: Lorebook): void {
  checkListing(book.name, book.listing!);
  if (!book.entries.some((e) => e.content.trim())) throw new PostError(400, 'invalid', '中身のある項目がありません');
  if (book.entries.length > TEXT_LIMITS.loreEntries) throw new PostError(400, 'invalid', `項目は${TEXT_LIMITS.loreEntries}個までです`);
  for (const e of book.entries) {
    if (over(e.content, TEXT_LIMITS.loreContent)) throw new PostError(400, 'invalid', `項目の本文は1つ${TEXT_LIMITS.loreContent}文字までです`);
    if (e.keys.length > TEXT_LIMITS.loreKeys || e.keys.some((k) => over(k, TEXT_LIMITS.loreKey))) throw new PostError(400, 'invalid', `キーワードは1項目${TEXT_LIMITS.loreKeys}個まで、1つ${TEXT_LIMITS.loreKey}文字までです`);
    if (e.comment && over(e.comment, TEXT_LIMITS.title)) throw new PostError(400, 'invalid', `項目の見出し（メモ）は${TEXT_LIMITS.title}文字までです`);
  }
}

// 保存する形。中身の JSON の名前は種類で分ける
type Prepared = { kind: 'plot'; json: BundleJson; images: Record<string, Uint8Array> } | { kind: 'lorebook'; json: LorebookBundleJson };

const jsonName = (kind: PostKind) => (kind === 'lorebook' ? 'lorebook.json' : 'plot.json');

// 届いたzipを確かめて、保存する形にする。画像は中身を見て形式を決め、作り直す（少なくとも埋め込まれた情報は消す）
async function prepare(bytes: Uint8Array, processor: ImageProcessor): Promise<Prepared> {
  let any: ReturnType<typeof unpackAnyBundle>;
  try {
    any = unpackAnyBundle(bytes, BUNDLE_LIMITS);
  } catch (e) {
    if (e instanceof BundleError) throw new PostError(400, 'bundle', e.message);
    throw e;
  }
  if (any.kind === 'lorebook') {
    // 共通の印と、投稿の印はサイトが決める
    const lorebook = { ...normalizeLorebook(any.json.lorebook ?? {}), global: false, posted: undefined, origin: undefined };
    checkLorebook(lorebook);
    return { kind: 'lorebook', json: { format: LOREBOOK_FORMAT, version: BUNDLE_VERSION, exportedAt: any.json.exportedAt ?? 0, lorebook } };
  }
  const unpacked = any;
  const plot = normalizePlot(unpacked.json.plot ?? {});
  checkText(plot);
  // 印はサイトが付けるので、届いたものは使わない
  plot.posted = undefined;
  plot.origin = undefined;

  const images: Record<string, Uint8Array> = {};
  const take = async (path: string | undefined, name: string, fit: ImageFit): Promise<string | undefined> => {
    const raw = path ? unpacked.images[path] : undefined;
    if (!raw) return undefined;
    let out: Awaited<ReturnType<ImageProcessor['process']>>;
    try {
      out = await processor.process(raw, fit);
    } catch {
      throw new PostError(400, 'image', '画像として読めないファイルがあります');
    }
    const inZip = `images/${name}.${out.kind}`;
    images[inZip] = out.bytes;
    return inZip;
  };
  plot.listing.cover = await take(plot.listing.cover, 'cover', COVER_FIT);
  for (const [i, c] of plot.characters.entries()) c.avatar = await take(c.avatar, `avatar-${i}`, AVATAR_FIT);
  const lorebooks = Array.isArray(unpacked.json.lorebooks) ? unpacked.json.lorebooks : [];
  return { kind: 'plot', json: { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: unpacked.json.exportedAt ?? 0, plot, lorebooks }, images };
}

export async function savePost(db: Db, blobs: Blobs, images: ImageProcessor, user: UserRow, bytes: Uint8Array, meta: PostMeta, now: number, existing?: PostRow): Promise<PostRow> {
  if (user.suspended_at) throw new PostError(403, 'suspended', 'このアカウントは利用が止められています');
  const prepared = await prepare(bytes, images);
  if (existing && existing.kind !== prepared.kind) throw new PostError(409, 'kind', existing.kind === 'lorebook' ? 'この投稿は設定集です。シナリオでは更新できません' : 'この投稿はシナリオです。設定集では更新できません');
  const { json } = prepared;
  const files = prepared.kind === 'plot' ? prepared.images : {};
  // 題名と紹介は、シナリオなら題名とシナリオの紹介、設定集なら名前と設定集の紹介
  const head = prepared.kind === 'plot' ? { title: prepared.json.plot.title, listing: prepared.json.plot.listing, cover: !!prepared.json.plot.listing.cover } : { title: prepared.json.lorebook.name, listing: prepared.json.lorebook.listing!, cover: false };
  if (isAdultRating(head.listing.rating)) {
    if (!user.adult) throw new PostError(403, 'adult', 'R-18とR-18Gの投稿は、18歳以上と答えた人だけができます');
    // 設定集には画像がないので、画像の確かめはいらない
    if (prepared.kind === 'plot' && !meta.imagesChecked) throw new PostError(400, 'images', 'R-18とR-18Gでは、画像の修正を確かめてから投稿してください');
  }
  let origin: string | null = null;
  if (meta.originPostId) {
    const o = await db.get<PostRow>('select * from posts where id = ?', meta.originPostId);
    if (o && o.author_id !== user.id) origin = o.id;
  }
  const id = existing?.id ?? newId(10);
  const text = JSON.stringify(json);
  const row: PostRow = {
    id,
    kind: prepared.kind,
    author_id: user.id,
    title: head.title,
    tagline: head.listing.tagline,
    intro: head.listing.intro,
    creator_comment: head.listing.creatorComment,
    hashtags: JSON.stringify(head.listing.hashtags),
    source_title: head.listing.sourceTitle,
    rating: head.listing.rating,
    has_cover: head.cover ? 1 : 0,
    visibility: meta.visibility === 'unlisted' ? 'unlisted' : 'public',
    status: existing?.status === 'hidden' ? 'hidden' : 'live',
    hidden_reason: existing?.status === 'hidden' ? existing.hidden_reason : null,
    origin_post_id: existing ? (origin ?? existing.origin_post_id) : origin,
    bundle_version: json.version,
    content_hash: await sha256(text),
    opens: existing?.opens ?? 0,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await blobs.deletePrefix(`posts/${id}/`);
  for (const [path, data] of Object.entries(files)) await blobs.put(`posts/${id}/${path}`, data);
  await blobs.put(`posts/${id}/${jsonName(prepared.kind)}`, new TextEncoder().encode(text));
  const cols = Object.keys(row) as (keyof PostRow)[];
  if (existing) {
    await db.run(`update posts set ${cols.filter((c) => c !== 'id').map((c) => `${c} = ?`).join(', ')} where id = ?`, ...cols.filter((c) => c !== 'id').map((c) => row[c]), id);
  } else {
    await db.run(`insert into posts (${cols.join(', ')}) values (${cols.map(() => '?').join(', ')})`, ...cols.map((c) => row[c]));
  }
  return row;
}

export function postRef(baseUrl: string, post: PostRow, authorName: string): PostRef {
  return { site: baseUrl, postId: post.id, authorId: post.author_id, authorName, title: post.title };
}

export async function readPlot(blobs: Blobs, postId: string): Promise<BundleJson | undefined> {
  const raw = await blobs.get(`posts/${postId}/plot.json`);
  return raw ? (JSON.parse(new TextDecoder().decode(raw)) as BundleJson) : undefined;
}

export async function readLorebook(blobs: Blobs, postId: string): Promise<LorebookBundleJson | undefined> {
  const raw = await blobs.get(`posts/${postId}/lorebook.json`);
  return raw ? (JSON.parse(new TextDecoder().decode(raw)) as LorebookBundleJson) : undefined;
}

// 配るときは、この投稿の印を posted に入れる。取り込んだ側で出どころに移る
export async function buildBundle(blobs: Blobs, post: PostRow, ref: PostRef): Promise<Uint8Array | undefined> {
  if (post.kind === 'lorebook') {
    const lore = await readLorebook(blobs, post.id);
    if (!lore) return undefined;
    lore.lorebook.posted = ref;
    return packLorebookBundle(lore);
  }
  const json = await readPlot(blobs, post.id);
  if (!json) return undefined;
  json.plot.posted = ref;
  const images: Record<string, Uint8Array> = {};
  for (const path of [json.plot.listing.cover, ...json.plot.characters.map((c) => c.avatar)]) {
    if (!path) continue;
    const data = await blobs.get(`posts/${post.id}/${path}`);
    if (data) images[path] = data;
  }
  return packBundle(json, images);
}

export async function withdrawPost(db: Db, blobs: Blobs, post: PostRow, now: number): Promise<void> {
  await blobs.deletePrefix(`posts/${post.id}/`);
  await db.run("update posts set status = 'withdrawn', updated_at = ? where id = ?", now, post.id);
}
