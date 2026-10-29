-- site/src/db.ts の SCHEMA と同じ。変えるときは両方そろえる（site/test/cloudflare.test.ts が確かめる）
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
