import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// 保存形式が変わっても利用者のデータが壊れないよう、user_version で版を管理し、起動時に移行する。
// 移行は足すだけにし、公開後は既存の段を書き換えない
const MIGRATIONS: ((db: DatabaseSync) => void)[] = [
  // 1: 最初の形
  (db) => {
    db.exec(`
      create table settings (key text primary key, data text not null);
      create table plots (id text primary key, data text not null, updated_at integer not null);
      create table players (id text primary key, data text not null, updated_at integer not null);
      create table lorebooks (id text primary key, data text not null, updated_at integer not null);
      create table presets (id text primary key, data text not null, updated_at integer not null);
      create table chats (id text primary key, plot_id text not null, data text not null, updated_at integer not null);
      create index chats_plot on chats (plot_id);
      create table messages (id text primary key, chat_id text not null, seq integer not null, data text not null);
      create index messages_chat on messages (chat_id, seq);
      create table summaries (id text primary key, chat_id text not null, data text not null);
      create index summaries_chat on summaries (chat_id);
      create table assist_threads (plot_id text primary key, data text not null);
    `);
  },
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('pragma journal_mode = wal; pragma foreign_keys = on; pragma busy_timeout = 5000;');
  migrate(db);
  return db;
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare('pragma user_version').get() as { user_version: number };
  const current = row.user_version;
  if (current > MIGRATIONS.length) {
    throw new Error(`データの版（${current}）がこのアプリ（${MIGRATIONS.length}）より新しいため開けません。アプリを更新してください。`);
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('begin');
    try {
      MIGRATIONS[v](db);
      db.exec(`pragma user_version = ${v + 1}`);
      db.exec('commit');
    } catch (e) {
      db.exec('rollback');
      throw e;
    }
  }
}
