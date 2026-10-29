import type { Blobs, Db, Param } from './db.ts';
import type { ImageProcessor } from './images.ts';
import { imageKind } from './util.ts';

// Cloudflare の D1、R2、Images を、サイトの Db、Blobs、ImageProcessor の形にする。
// 型は使うところだけをここに書き、@cloudflare/workers-types には頼らない

export interface D1PreparedStatement {
  bind(...values: Param[]): D1PreparedStatement;
  run(): Promise<unknown>;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
}

export interface R2ObjectBody {
  arrayBuffer(): Promise<ArrayBuffer>;
}
export interface R2Bucket {
  put(key: string, value: Uint8Array): Promise<unknown>;
  get(key: string): Promise<R2ObjectBody | null>;
  list(options: { prefix: string; cursor?: string }): Promise<{ objects: { key: string }[]; truncated: boolean; cursor?: string }>;
  delete(keys: string[]): Promise<void>;
}

export interface ImagesBinding {
  input(stream: ReadableStream<Uint8Array>): {
    transform(options: { width: number; height: number; fit: 'scale-down' }): {
      output(options: { format: 'image/webp'; quality: number }): Promise<{ response(): Response }>;
    };
  };
}

export function d1Db(d1: D1Database): Db {
  return {
    async run(sql, ...params) {
      await d1.prepare(sql).bind(...params).run();
    },
    async get<T>(sql: string, ...params: Param[]) {
      return (await d1.prepare(sql).bind(...params).first<T>()) ?? undefined;
    },
    async all<T>(sql: string, ...params: Param[]) {
      return (await d1.prepare(sql).bind(...params).all<T>()).results;
    },
  };
}

export function r2Blobs(r2: R2Bucket): Blobs {
  return {
    async put(key, data) {
      await r2.put(key, data);
    },
    async get(key) {
      const o = await r2.get(key);
      return o ? new Uint8Array(await o.arrayBuffer()) : undefined;
    },
    // R2 は前方一致で消せないので、一覧を取って消す。消しながら続きを読むと位置がずれるので、毎回最初から取り直す
    async deletePrefix(prefix) {
      for (;;) {
        const page = await r2.list({ prefix });
        if (page.objects.length === 0) return;
        await r2.delete(page.objects.map((o) => o.key));
        if (!page.truncated) return;
      }
    },
  };
}

// 作り直すと、画像に埋め込まれた情報も一緒に落ちる
export function cfImages(images: ImagesBinding): ImageProcessor {
  return {
    async process(bytes, fit) {
      if (!imageKind(bytes)) throw new Error('画像として読めません');
      const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
      const out = await images.input(stream).transform({ width: fit.maxWidth, height: fit.maxHeight, fit: 'scale-down' }).output({ format: 'image/webp', quality: 85 });
      const data = new Uint8Array(await out.response().arrayBuffer());
      if (imageKind(data) !== 'webp') throw new Error('画像を作り直せませんでした');
      return { bytes: data, kind: 'webp' };
    },
  };
}
