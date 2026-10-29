-- site/src/db.ts の MIGRATIONS の2つ目と同じ。Google や Discord で初めてログインした人の、登録を終えるまでの預かり
create table if not exists signups (id text primary key, provider text not null, provider_user_id text not null, suggested_name text not null, next text not null, expires_at integer not null);
