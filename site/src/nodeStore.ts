import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { MIGRATIONS, SCHEMA, type Blobs, type Db, type Param } from './db.ts';

// 手元とテスト用。本番の D1 と R2 の代わりに、node:sqlite とフォルダを使う

// 表を変えた分を当てる。すでに当たっていれば（同じ列がある）飛ばす
export function migrate(db: DatabaseSync): void {
  for (const sql of MIGRATIONS) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!/duplicate column/i.test((e as Error).message)) throw e;
    }
  }
}

export function nodeDb(file: string): Db & { close(): void } {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma busy_timeout = 5000;');
  db.exec(SCHEMA);
  migrate(db);
  return {
    async run(sql: string, ...params: Param[]) {
      db.prepare(sql).run(...params);
    },
    async get<T>(sql: string, ...params: Param[]) {
      return db.prepare(sql).get(...params) as T | undefined;
    },
    async all<T>(sql: string, ...params: Param[]) {
      return db.prepare(sql).all(...params) as T[];
    },
    close: () => db.close(),
  };
}

export function nodeBlobs(dir: string): Blobs {
  const root = resolve(dir);
  // 鍵はサイトの中で作るものだけだが、念のためフォルダの外を指させない
  const pathOf = (key: string): string => {
    const full = resolve(root, key);
    if (!full.startsWith(root + sep)) throw new Error(`置き場所の鍵が正しくありません: ${key}`);
    return full;
  };
  return {
    async put(key, data) {
      const full = pathOf(key);
      mkdirSync(join(full, '..'), { recursive: true });
      writeFileSync(full, data);
    },
    async get(key) {
      const full = pathOf(key);
      return existsSync(full) ? new Uint8Array(readFileSync(full)) : undefined;
    },
    async deletePrefix(prefix) {
      rmSync(pathOf(prefix.replace(/\/$/, '')), { recursive: true, force: true });
    },
  };
}
