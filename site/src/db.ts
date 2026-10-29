// 投稿サイトのデータの置き場所。本番は Cloudflare の D1 と R2、手元とテストは node:sqlite とフォルダを使う。
// どちらでも動くよう、使う操作をここに絞る

export type Param = string | number | null;

export interface Db {
  run(sql: string, ...params: Param[]): Promise<void>;
  get<T>(sql: string, ...params: Param[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: Param[]): Promise<T[]>;
}

export interface Blobs {
  put(key: string, data: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  deletePrefix(prefix: string): Promise<void>;
}

// 真偽は0と1で持つ。D1もSQLiteなので同じ書き方で通る。
// 初めの表は SCHEMA（migrations/0001_init.sql）、あとから変えた分は MIGRATIONS（0002 から順に1つずつ）
export const SCHEMA = `
create table if not exists users (
  id text primary key,
  provider text not null,
  provider_user_id text not null,
  display_name text not null,
  adult integer not null default 0,
  show_adult integer not null default 0,
  terms_version integer not null default 0,
  admin integer not null default 0,
  created_at integer not null,
  suspended_at integer,
  unique (provider, provider_user_id)
);
create table if not exists sessions (id text primary key, user_id text not null, expires_at integer not null);
create table if not exists posts (
  id text primary key,
  author_id text not null,
  title text not null,
  tagline text not null,
  intro text not null,
  creator_comment text not null,
  hashtags text not null,
  source_title text not null,
  rating text not null,
  has_cover integer not null default 0,
  visibility text not null,
  status text not null,
  hidden_reason text,
  origin_post_id text,
  bundle_version integer not null,
  content_hash text not null,
  opens integer not null default 0,
  created_at integer not null,
  updated_at integer not null
);
create index if not exists posts_list on posts (status, visibility, updated_at);
create index if not exists posts_author on posts (author_id);
create table if not exists app_tokens (
  id text primary key,
  user_id text not null,
  token_hash text not null unique,
  label text not null,
  created_at integer not null,
  last_used_at integer,
  revoked_at integer
);
create table if not exists auth_codes (
  code text primary key,
  user_id text not null,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at integer not null
);
create table if not exists tickets (id text primary key, post_id text not null, user_id text not null, expires_at integer not null, used_at integer);
create table if not exists reports (
  id text primary key,
  post_id text,
  kind text not null,
  detail text not null,
  contact text,
  created_at integer not null,
  resolved_at integer,
  action text
);
`;

// 0002_lorebook.sql: 設定集だけの投稿。kind は plot（シナリオ）か lorebook（設定集）
// 0003_signups.sql: Google や Discord で初めてログインした人の、登録を終えるまでの預かり
export const MIGRATIONS = [
  `alter table posts add column kind text not null default 'plot';`,
  `create table if not exists signups (id text primary key, provider text not null, provider_user_id text not null, suggested_name text not null, next text not null, expires_at integer not null);`,
  // 0004_name_key.sql: 名前が重ならないようにする。比べる形（全角半角、大文字小文字、空白をそろえたもの）を持つ。前からの利用者は空のまま
  `alter table users add column name_key text;
create unique index if not exists users_name_key on users (name_key);`,
];
