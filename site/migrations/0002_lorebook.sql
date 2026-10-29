-- site/src/db.ts の MIGRATIONS の1つ目と同じ。設定集だけの投稿
alter table posts add column kind text not null default 'plot';
