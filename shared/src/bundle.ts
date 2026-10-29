import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { Lorebook, Plot } from './types.ts';

// シナリオの書き出し形式。JSONと画像をまとめたzipを1つ。アプリと投稿サイトで同じものを使う
export const BUNDLE_FORMAT = 'archsage-plot';
export const BUNDLE_VERSION = 1;

export interface BundleJson {
  format: string;
  version: number;
  exportedAt: number;
  plot: Plot;
  lorebooks: Lorebook[];
}

// 設定集だけの書き出し形式。画像はなく、zipに lorebook.json を1つ入れる
export const LOREBOOK_FORMAT = 'archsage-lorebook';

export interface LorebookBundleJson {
  format: string;
  version: number;
  exportedAt: number;
  lorebook: Lorebook;
}

export type AnyBundle = { kind: 'plot'; json: BundleJson; images: Record<string, Uint8Array> } | { kind: 'lorebook'; json: LorebookBundleJson };

// 届いたzipは信用しない。開く前に大きさと中身の名前を確かめる
export interface BundleLimits {
  zipBytes: number;
  unpackedBytes: number; // 展開したあとの合計。圧縮爆弾を弾く
  files: number;
}

export const BUNDLE_LIMITS: BundleLimits = { zipBytes: 30 * 1024 * 1024, unpackedBytes: 80 * 1024 * 1024, files: 64 };

export class BundleError extends Error {}

const IMAGE_PATH = /^images\/[A-Za-z0-9._-]+\.(png|jpe?g|webp)$/;

export function packBundle(json: BundleJson, images: Record<string, Uint8Array>): Uint8Array {
  const files: Zippable = {};
  for (const [path, bytes] of Object.entries(images)) {
    if (!IMAGE_PATH.test(path)) throw new BundleError(`zipに入れられない画像の名前です: ${path}`);
    files[path] = [bytes, { level: 0 }];
  }
  files['plot.json'] = strToU8(JSON.stringify(json, null, 2));
  return zipSync(files);
}

export function packLorebookBundle(json: LorebookBundleJson): Uint8Array {
  return zipSync({ 'lorebook.json': strToU8(JSON.stringify(json, null, 2)) });
}

// シナリオのzipだけを受け付ける
export function unpackBundle(data: Uint8Array, limits: BundleLimits = BUNDLE_LIMITS): { json: BundleJson; images: Record<string, Uint8Array> } {
  const b = unpackAnyBundle(data, limits);
  if (b.kind !== 'plot') throw new BundleError('これは設定集のzipです。設定集の画面から取り込んでください');
  return b;
}

// シナリオか設定集のzipを開く。どちらかは中の JSON の名前で決める
export function unpackAnyBundle(data: Uint8Array, limits: BundleLimits = BUNDLE_LIMITS): AnyBundle {
  if (data.byteLength > limits.zipBytes) throw new BundleError('zipが大きすぎます');
  let count = 0;
  let total = 0;
  let bad = '';
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(data, {
      filter: (f) => {
        if (f.name.endsWith('/')) return false;
        count++;
        total += f.originalSize;
        if (f.name !== 'plot.json' && f.name !== 'lorebook.json' && !IMAGE_PATH.test(f.name)) bad ||= f.name;
        return !bad && count <= limits.files && total <= limits.unpackedBytes;
      },
    });
  } catch {
    throw new BundleError('zipを開けませんでした');
  }
  if (bad) throw new BundleError(`zipに知らないファイルがあります: ${bad}`);
  if (count > limits.files) throw new BundleError('zipの中のファイルが多すぎます');
  if (total > limits.unpackedBytes) throw new BundleError('zipの中身が大きすぎます');

  const loreBytes = entries['lorebook.json'];
  if (loreBytes && !entries['plot.json']) {
    let lore: LorebookBundleJson;
    try {
      lore = JSON.parse(strFromU8(loreBytes));
    } catch {
      throw new BundleError('lorebook.json を読めませんでした');
    }
    if (!lore || typeof lore !== 'object' || lore.format !== LOREBOOK_FORMAT || !lore.lorebook || typeof lore.lorebook !== 'object') throw new BundleError('Archsage の設定集ではありません');
    if (typeof lore.version !== 'number' || lore.version > BUNDLE_VERSION) throw new BundleError('この設定集は新しい版のアプリで書き出されています。アプリを更新してください');
    if (Object.keys(entries).length > 1) throw new BundleError('設定集のzipに知らないファイルがあります');
    return { kind: 'lorebook', json: lore };
  }
  const jsonBytes = entries['plot.json'];
  if (!jsonBytes) throw new BundleError('zipに plot.json がありません');
  let json: BundleJson;
  try {
    json = JSON.parse(strFromU8(jsonBytes));
  } catch {
    throw new BundleError('plot.json を読めませんでした');
  }
  if (!json || typeof json !== 'object' || json.format !== BUNDLE_FORMAT) throw new BundleError('Archsage のシナリオではありません');
  if (typeof json.version !== 'number' || json.version > BUNDLE_VERSION) throw new BundleError('このシナリオは新しい版のアプリで書き出されています。アプリを更新してください');
  const images: Record<string, Uint8Array> = {};
  for (const [path, bytes] of Object.entries(entries)) if (path !== 'plot.json' && path !== 'lorebook.json') images[path] = bytes;
  return { kind: 'plot', json, images };
}
