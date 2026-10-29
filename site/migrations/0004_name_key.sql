-- site/src/db.ts の MIGRATIONS の3つ目と同じ。名前が重ならないようにする
alter table users add column name_key text;
create unique index if not exists users_name_key on users (name_key);
