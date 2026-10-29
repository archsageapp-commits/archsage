import { readFileSync } from 'node:fs';
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  BundleError,
  carriedOrigin,
  LOREBOOK_FORMAT,
  newId,
  normalizeLorebook,
  normalizePlot,
  packBundle,
  packLorebookBundle,
  stripImageMetadata,
  unpackAnyBundle,
  unpackBundle,
  type BundleJson,
  type Lorebook,
  type Plot,
} from '@archsage/shared';
import type { Core } from './core.ts';
import { HttpError } from './core.ts';

// zipの形は shared/src/bundle.ts。ここは画像の出し入れとストアへの保存だけ受け持つ

function ext(rel: string): string {
  return rel.split('.').pop() ?? 'png';
}

// キャラクターのidは取り込んだJSONから来るので、ファイル名に使う前に削る
function safeName(s: string): string {
  return s.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'x';
}

export function exportPlot(core: Core, plotId: string): Uint8Array {
  const plot = structuredClone(core.plotOf(plotId));
  const images: Record<string, Uint8Array> = {};
  // 生成の設定が画像に残っていると、使ったプロンプトまで配ってしまうので消して入れる
  const addImage = (rel: string | undefined, name: string): string | undefined => {
    if (!rel) return undefined;
    const full = core.imagePath(rel);
    if (!full) return undefined;
    const inZip = `images/${name}.${ext(rel)}`;
    images[inZip] = stripImageMetadata(new Uint8Array(readFileSync(full)));
    return inZip;
  };
  plot.listing.cover = addImage(plot.listing.cover, 'cover');
  for (const c of plot.characters) {
    c.avatar = addImage(c.avatar, `avatar-${safeName(c.id)}`);
    delete c.fullBody;
  }
  // 立ち絵は服装を確かめるための自分用の絵なので、書き出しと投稿には入れない
  for (const pl of plot.players) delete pl.fullBody;
  // 自分用の相談の履歴は含めない
  // シナリオの中に写す設定集は、シナリオの一部。設定集だけで投稿した紹介と印は入れない
  const lorebooks = core.store.lorebooks
    .list()
    .filter((l) => plot.lorebookIds.includes(l.id) && !l.global)
    .map(({ listing: _l, posted: _p, origin: _o, ...b }) => b);
  const json: BundleJson = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: Date.now(), plot, lorebooks };
  return packBundle(json, images);
}

export function importPlot(core: Core, data: Uint8Array): Plot {
  try {
    const { json, images } = unpackBundle(data);
    return importBundle(core, json, images);
  } catch (e) {
    if (e instanceof BundleError) throw new HttpError(400, e.message);
    throw e;
  }
}

export function importBundle(core: Core, json: BundleJson, entries: Record<string, Uint8Array>): Plot {
  if (json.format !== BUNDLE_FORMAT) throw new HttpError(400, 'Archsage のシナリオではありません');
  if (json.version > BUNDLE_VERSION) throw new HttpError(400, 'このシナリオは新しい版のアプリで書き出されています。アプリを更新してください');

  const now = Date.now();
  // 取り込んだものは別のシナリオ。投稿した印は、出どころとして引き継ぐ
  const plot = normalizePlot({ ...json.plot, id: newId(), createdAt: now, updatedAt: now, posted: undefined, origin: carriedOrigin(json.plot ?? {}) });
  const saveFrom = (inZip: string | undefined, name: string): string | undefined => {
    if (!inZip || !entries[inZip]) return undefined;
    const rel = `plots/${plot.id}/${name}-${newId(6)}.${ext(inZip)}`;
    core.saveImage(rel, Buffer.from(entries[inZip]));
    return rel;
  };
  plot.listing.cover = saveFrom(json.plot.listing?.cover, 'cover');
  for (const c of plot.characters) {
    c.avatar = saveFrom(c.avatar, `avatar-${safeName(c.id)}`);
    delete c.fullBody;
  }
  for (const pl of plot.players) delete pl.fullBody;

  const idMap = new Map<string, string>();
  const books = (json.lorebooks ?? []).map((b) => {
    const id = newId();
    idMap.set(b.id, id);
    return { ...normalizeLorebook({ ...b, global: false }, id), listing: undefined, posted: undefined, origin: undefined };
  });
  plot.lorebookIds = plot.lorebookIds.map((id) => idMap.get(id)).filter((x): x is string => !!x);
  core.store.tx(() => {
    for (const b of books) core.store.lorebooks.put(b);
    core.store.plots.put(plot);
  });
  return plot;
}

// 設定集だけの書き出し。投稿にも使う
export function exportLorebook(core: Core, lorebookId: string): Uint8Array {
  const book = core.store.lorebooks.get(lorebookId);
  if (!book) throw new HttpError(404, '設定集が見つかりません');
  const lorebook: Lorebook = { ...normalizeLorebook(book), global: false };
  return packLorebookBundle({ format: LOREBOOK_FORMAT, version: BUNDLE_VERSION, exportedAt: Date.now(), lorebook });
}

// 設定集のzipを取り込む。別の設定集として入れ、共通にはしない（使うシナリオで選ぶ）
export function importLorebook(core: Core, data: Uint8Array): Lorebook {
  let b: ReturnType<typeof unpackAnyBundle>;
  try {
    b = unpackAnyBundle(data);
  } catch (e) {
    if (e instanceof BundleError) throw new HttpError(400, e.message);
    throw e;
  }
  if (b.kind !== 'lorebook') throw new HttpError(400, 'これはシナリオのzipです。シナリオ管理から取り込んでください');
  const src = b.json.lorebook;
  const book = normalizeLorebook({ ...src, global: false, posted: undefined, origin: carriedOrigin(normalizeLorebook(src)) }, newId());
  return core.store.lorebooks.put(book);
}
