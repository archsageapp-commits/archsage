import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { newId, type Lorebook, type LorebookListing } from '@archsage/shared';
import { api } from '../api.ts';
import { lorebookPostItem, PostDialog } from '../components/PostDialog.tsx';
import { Page } from '../Layout.tsx';
import { T } from '../terms.ts';
import { Badge, Button, Card, ConfirmButton, cx, Empty, ErrorText, Field, Icon, Input, TagsInput, TextArea, Toggle } from '../ui.tsx';

const EMPTY_LISTING: LorebookListing = { tagline: '', hashtags: [], intro: '', creatorComment: '', rating: 'all', sourceTitle: '' };

export function LorebooksPage() {
  const qc = useQueryClient();
  const books = useQuery({ queryKey: ['lorebooks'], queryFn: api.lorebooks });
  const plots = useQuery({ queryKey: ['plots'], queryFn: api.plots });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const sitePosts = useQuery({ queryKey: ['sitePosts'], queryFn: api.sitePosts, enabled: !!settings.data?.site.connected, retry: false });
  // サイトから取り込んだときは、その設定集を開く
  const [params] = useSearchParams();
  const [sel, setSel] = useState(params.get('id') ?? '');
  const [posting, setPosting] = useState(false);
  const [showListing, setShowListing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Lorebook | null>(null);
  const [dirty, setDirty] = useState(false);
  const current = books.data?.find((b) => b.id === sel) ?? books.data?.[0];

  useEffect(() => {
    if (current && (!draft || draft.id !== current.id)) {
      setDraft(structuredClone(current));
      setDirty(false);
    }
  }, [current, draft]);

  const edit = (fn: (b: Lorebook) => void) => {
    if (!draft) return;
    const next = structuredClone(draft);
    fn(next);
    setDraft(next);
    setDirty(true);
  };

  const create = useMutation({
    mutationFn: () => api.createLorebook({ name: `新しい${T.lorebook}`, global: false, entries: [] }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['lorebooks'] });
      setSel(b.id);
      setDraft(b);
    },
  });
  const save = useMutation({
    mutationFn: (b: Lorebook) => api.saveLorebook(b),
    onSuccess: (b) => {
      setDirty(false);
      setDraft(b);
      qc.invalidateQueries({ queryKey: ['lorebooks'] });
    },
  });
  const imp = useMutation({
    mutationFn: (f: File) => api.importLorebook(f),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['lorebooks'] });
      setSel(b.id);
    },
  });
  const del = useMutation({
    mutationFn: (bid: string) => api.deleteLorebook(bid),
    onSuccess: () => {
      setSel('');
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['lorebooks'] });
    },
  });

  const usedBy = (bid: string) => (plots.data ?? []).filter((p) => p.lorebookIds.includes(bid)).map((p) => p.title || '（無題）');
  const listing = draft?.listing ?? EMPTY_LISTING;
  const editListing = (fn: (l: LorebookListing) => void) => edit((b) => void fn((b.listing ??= { ...EMPTY_LISTING })));

  return (
    <Page
      title={T.lorebook}
      actions={
        <>
          <input
            ref={fileRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) imp.mutate(f);
              e.target.value = '';
            }}
          />
          <Button onClick={() => fileRef.current?.click()} disabled={imp.isPending}>
            <Icon name="upload" /> 取り込む
          </Button>
          <Button variant="primary" onClick={() => create.mutate()}>
            <Icon name="plus" /> 新しい{T.lorebook}
          </Button>
        </>
      }
    >
      <p className="-mt-3 mb-5 text-sm text-dim">キーワードが直近の会話に出たときだけ、内容をプロンプトに差し込みます。「常に入れる」にした項目は毎回入ります。「全チャット共通」にした{T.lorebook}はすべてのチャットで使い、そうでないものは、使う{T.plot}の編集画面の「{T.lorebook}」タブで選びます。</p>
      <ErrorText error={imp.error} />
      {books.data?.length === 0 && <Empty>まだ{T.lorebook}がありません</Empty>}
      {books.data && books.data.length > 0 && (
        <div className="grid gap-5 md:grid-cols-[220px_1fr]">
          <div className="space-y-1">
            {books.data.map((b) => (
              <button key={b.id} type="button" onClick={() => setSel(b.id)} className={cx('flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm', b.id === current?.id ? 'bg-panel2 text-gold' : 'text-dim hover:bg-panel hover:text-ink')}>
                <span className="min-w-0 flex-1 truncate">{b.name || '（無題）'}</span>
                {b.global && <Badge>共通</Badge>}
                {b.posted && <Badge tone="gold">投稿済み</Badge>}
              </button>
            ))}
          </div>
          {draft && (
            <div className="space-y-4">
              <Card className="space-y-4 p-4">
                <div className="flex items-center gap-4">
                  {/* 名前は見出しらしく大きく。下の項目の欄と見分けやすくする */}
                  <input
                    aria-label={`${T.lorebook}の名前`}
                    className="min-w-0 flex-1 border-b border-line bg-transparent pb-1 text-lg font-semibold text-ink outline-none placeholder:text-faint focus:border-gold"
                    value={draft.name}
                    placeholder={`${T.lorebook}の名前`}
                    onChange={(e) => edit((b) => void (b.name = e.target.value))}
                  />
                  <Toggle checked={draft.global} onChange={(v) => edit((b) => void (b.global = v))} label="全チャット共通" />
                </div>
                {!draft.global && <div className="text-xs text-faint">使っている{T.plot}: {usedBy(draft.id).join('、') || 'なし'}</div>}
                <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  <Button size="sm" onClick={() => setPosting(true)} disabled={dirty} title={dirty ? '保存してから投稿できます' : undefined}>
                    <Icon name="send" size={13} /> {draft.posted ? '投稿を更新' : '投稿する'}
                  </Button>
                  <a href={api.lorebookExportUrl(draft.id)}>
                    <Button size="sm" disabled={dirty}>
                      <Icon name="download" size={13} /> 書き出す
                    </Button>
                  </a>
                  <Button size="sm" variant="ghost" onClick={() => setShowListing(!showListing)}>
                    <Icon name="edit" size={13} /> 投稿の紹介{showListing ? 'を閉じる' : ''}
                  </Button>
                  {dirty && <span className="text-xs text-faint">保存してから投稿と書き出しができます</span>}
                </div>
                {showListing && (
                  <div className="space-y-3">
                    <p className="text-xs text-faint">{T.lorebook}だけを{T.site}に投稿するときの紹介です。{T.plot}の中に入れて投稿するときは使いません。レーティングと元作品名は、投稿の画面で選びます。</p>
                    <Field label="一言紹介">
                      <Input value={listing.tagline} onChange={(e) => editListing((l) => void (l.tagline = e.target.value))} />
                    </Field>
                    <Field label="ハッシュタグ" hint="Enterで区切ります">
                      <TagsInput value={listing.hashtags} onChange={(v) => editListing((l) => void (l.hashtags = v))} placeholder="例 ファンタジー, 魔法" />
                    </Field>
                    <Field label="紹介文">
                      <TextArea autoGrow rows={3} value={listing.intro} onChange={(e) => editListing((l) => void (l.intro = e.target.value))} />
                    </Field>
                    <Field label="作者コメント">
                      <TextArea autoGrow rows={2} value={listing.creatorComment} onChange={(e) => editListing((l) => void (l.creatorComment = e.target.value))} />
                    </Field>
                  </div>
                )}
              </Card>
              {draft.entries.map((e, i) => (
                <Card key={e.id} className={cx('space-y-3 p-4', !e.enabled && 'opacity-60')}>
                  <div className="flex items-center gap-3">
                    <Input className="h-8 flex-1 text-sm" value={e.comment ?? ''} placeholder="メモ（プロンプトには入りません）" onChange={(ev) => edit((b) => void (b.entries[i].comment = ev.target.value))} />
                    <Toggle checked={e.constant} onChange={(v) => edit((b) => void (b.entries[i].constant = v))} label="常に入れる" />
                    <Toggle checked={e.enabled} onChange={(v) => edit((b) => void (b.entries[i].enabled = v))} label="有効" />
                    <ConfirmButton variant="ghost" onConfirm={() => edit((b) => void b.entries.splice(i, 1))} confirmLabel="消す？">
                      <Icon name="trash" size={13} />
                    </ConfirmButton>
                  </div>
                  {!e.constant && (
                    <Field label="キーワード" hint="Enterで区切ります。大文字と小文字は区別しません">
                      <TagsInput value={e.keys} onChange={(v) => edit((b) => void (b.entries[i].keys = v))} />
                    </Field>
                  )}
                  <TextArea rows={4} value={e.content} placeholder="差し込む内容" onChange={(ev) => edit((b) => void (b.entries[i].content = ev.target.value))} />
                </Card>
              ))}
              <Button onClick={() => edit((b) => void b.entries.push({ id: newId(), keys: [], content: '', constant: false, enabled: true }))}>
                <Icon name="plus" /> 項目を足す
              </Button>
              <ErrorText error={save.error} />
              <div className="flex justify-between border-t border-line pt-4">
                <ConfirmButton onConfirm={() => del.mutate(draft.id)}>
                  <Icon name="trash" size={13} /> この{T.lorebook}を消す
                </ConfirmButton>
                <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
                  {dirty ? '保存' : '保存済み'}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {posting && draft && (
        <PostDialog item={lorebookPostItem(draft)} sitePost={draft.posted ? sitePosts.data?.posts.find((x) => x.id === draft.posted!.postId) : undefined} onClose={() => setPosting(false)} />
      )}
    </Page>
  );
}
