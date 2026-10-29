import { stripImageMetadata } from '@archsage/shared';
import { imageKind } from './util.ts';

// 投稿の画像の作り直し。本番は Cloudflare Images で WebP にして縮める（cloudflare.ts）。
// 手元とテストは作り直さず、埋め込まれた情報を消すだけにする

export type ImageKind = 'png' | 'jpg' | 'webp';

export interface ImageFit {
  maxWidth: number;
  maxHeight: number;
}

// サムネイルはアプリで作る大きさ（shared の COVER_SIZE）まで、アイコンは丸く小さく出すので 512 まで
export const COVER_FIT: ImageFit = { maxWidth: 1024, maxHeight: 1536 };
export const AVATAR_FIT: ImageFit = { maxWidth: 512, maxHeight: 512 };

export interface ImageProcessor {
  process(bytes: Uint8Array, fit: ImageFit): Promise<{ bytes: Uint8Array; kind: ImageKind }>;
}

export const passthroughImages: ImageProcessor = {
  async process(bytes) {
    const kind = imageKind(bytes);
    if (!kind) throw new Error('画像として読めません');
    return { bytes: stripImageMetadata(bytes), kind };
  },
};
