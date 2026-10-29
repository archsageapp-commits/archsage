import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  estimateTokens,
  newId,
  normalizeCharacter,
  normalizePlayer,
  type Plot,
  type PlotCharacter,
} from '@archsage/shared';
import { api, imageUrl } from '../api.ts';
import { OutfitEditor } from '../components/OutfitEditor.tsx';
import { PostDialog, plotPostItem } from '../components/PostDialog.tsx';
import { IllustFields, PlayerFields } from '../components/Fields.tsx';
import { RATING_LABELS, T } from '../terms.ts';
import { Badge, Button, Card, ConfirmButton, cx, Empty, ErrorText, Field, Icon, Input, Segmented, Spinner, Tabs, TagsInput, TextArea } from '../ui.tsx';

type TabKey = 'story' | 'characters' | 'players' | 'examples' | 'lore' | 'intros' | 'illust' | 'listing';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'story', label: T.story },
  { key: 'characters', label: T.character },
  { key: 'players', label: T.player },
  { key: 'examples', label: T.examples },
  { key: 'lore', label: T.lorebook },
  { key: 'intros', label: T.intro },
  { key: 'illust', label: T.illust },
  { key: 'listing', label: '投稿' },
];

type Update = (fn: (p: Plot) => void) => void;

export function PlotEditorPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['plot', id], queryFn: () => api.plot(id) });
  const [draft, setDraft] = useState<Plot | null>(null);
  const [tab, setTab] = useState<TabKey>('story');
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState<unknown>(null);

  const draftRef = useRef<Plot | null>(null);
  draftRef.current = draft;
  const version = useRef(0);
  const savedVersion = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (q.data && !draftRef.current) setDraft(q.data);
  }, [q.data]);

  const save = useCallback(async () => {
    const v = version.current;
    const d = draftRef.current;
    if (!d || v === savedVersion.current) return;
    setStatus('saving');
    try {
      const r = await api.savePlot(d);
      savedVersion.current = v;
      qc.setQueryData(['plot', id], r);
      qc.invalidateQueries({ queryKey: ['plots'] });
      setSaveError(null);
      setStatus(v === version.current ? 'saved' : 'dirty');
    } catch (e) {
      setSaveError(e);
      setStatus('error');
    }
  }, [id, qc]);

  const update: Update = useCallback(
    (fn) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const next = structuredClone(prev);
        fn(next);
        return next;
      });
      version.current++;
      setStatus('dirty');
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), 800);
    },
    [save],
  );

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    // 状態の反映を待ってから保存する
    await new Promise((r) => setTimeout(r, 0));
    await save();
  }, [save]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void save();
    },
    [save],
  );

  const replaceFromServer = (p: Plot) => {
    setDraft(p);
    version.current++;
    savedVersion.current = version.current;
    qc.setQueryData(['plot', id], p);
    setStatus('saved');
  };

  if (!draft) return <div className="p-6">{q.error ? <ErrorText error={q.error} /> : <Spinner />}</div>;

  const tokens = estimateTokens(
    [draft.story, draft.narratorNote, draft.playerPosition, draft.examples, ...draft.characters.map((c) => `${c.name}\n${c.profile}`)].join('\n'),
  );

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-5 py-2.5">
          <Link to={`/plots/${id}`} className="text-dim hover:text-ink" title="戻る">
            <Icon name="left" />
          </Link>
          <div className="min-w-0 flex-1 truncate font-semibold">{draft.title || '（無題）'}</div>
          <span className="text-xs text-faint" title="LLMに毎回送る分の目安">
            送信の目安 約{tokens.toLocaleString()}トークン
          </span>
          <span className={cx('w-20 text-right text-xs', status === 'error' ? 'text-danger' : 'text-faint')}>
            {status === 'saving' ? '保存中…' : status === 'dirty' ? '未保存' : status === 'error' ? '保存に失敗' : '保存済み'}
          </span>
          <Button size="sm" onClick={() => void flush()} disabled={status === 'saved'}>
            保存
          </Button>
          <Link to={`/plots/${id}/wizard`} onClick={() => void flush()}>
            <Button size="sm" variant="primary" title="AIと相談しながら、世界観、キャラクター、導入などを作り直す">
              <Icon name="sparkle" size={14} /> AIと編集
            </Button>
          </Link>
        </div>
        <Tabs tabs={TABS} value={tab} onChange={setTab} className="px-4" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-6 py-5">
            <ErrorText error={saveError} />
            {tab === 'story' && <StoryTab p={draft} update={update} />}
            {tab === 'characters' && <CharactersTab p={draft} update={update} flush={flush} onServer={replaceFromServer} />}
            {tab === 'players' && <PlayersTab p={draft} update={update} />}
            {tab === 'examples' && <ExamplesTab p={draft} update={update} />}
            {tab === 'lore' && <LoreTab p={draft} update={update} />}
            {tab === 'intros' && <IntrosTab p={draft} update={update} />}
            {tab === 'illust' && <IllustTab p={draft} update={update} />}
            {tab === 'listing' && <ListingTab p={draft} update={update} flush={flush} onServer={replaceFromServer} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children, hint, right }: { title: ReactNode; children: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-faint">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

function StoryTab({ p, update }: { p: Plot; update: Update }) {
  return (
    <>
      <Section title="題名と世界観">
        <div className="space-y-4">
          <Field label="題名">
            <Input value={p.title} onChange={(e) => update((d) => void (d.title = e.target.value))} placeholder="例 放課後の魔法研究会" />
          </Field>
          <Field label={`${T.story}の説明`} hint="ジャンル、舞台、登場人物、関係など。{{user}} と {{char}} が使えます">
            <TextArea rows={12} value={p.story} onChange={(e) => update((d) => void (d.story = e.target.value))} />
          </Field>
        </div>
      </Section>
      <Section title={T.narratorNote} hint={`遊んでみて気になった返答の癖を直すための指示です。毎回の返答の直前に入るので、短く書いてください。${T.wizard}では扱いません`}>
        <TextArea rows={4} value={p.narratorNote} onChange={(e) => update((d) => void (d.narratorNote = e.target.value))} placeholder="例 {{user}}の行動やセリフを書かない。しずくは敬語を崩さない" />
      </Section>
    </>
  );
}

function AvatarBox({ src, name, onGenerate, onUpload, busy }: { src?: string; name: string; onGenerate: () => void; onUpload: (f: File) => void; busy: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-28 w-28 overflow-hidden rounded-full border border-line bg-panel2">
        {src ? <img src={imageUrl(src)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-3xl text-faint">{name.slice(0, 1) || '?'}</div>}
        {busy && (
          <div className="absolute inset-0 flex items-center justify-center bg-panel/70">
            <Spinner />
          </div>
        )}
      </div>
      <div className="flex gap-1">
        <Button size="sm" onClick={onGenerate} disabled={busy} title="ComfyUIでバストアップを作る">
          <Icon name="sparkle" size={13} /> 生成
        </Button>
        <Button size="sm" onClick={() => ref.current?.click()} disabled={busy}>
          <Icon name="upload" size={13} />
        </Button>
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onUpload(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

function CharactersTab({ p, update, flush, onServer }: { p: Plot; update: Update; flush: () => Promise<void>; onServer: (p: Plot) => void }) {
  const [sel, setSel] = useState(p.characters[0]?.id ?? '');
  const c = p.characters.find((x) => x.id === sel) ?? p.characters[0];
  const idx = c ? p.characters.indexOf(c) : -1;
  const set = (fn: (c: PlotCharacter) => void) => update((d) => fn(d.characters[idx]));
  const img = useMutation({
    mutationFn: async (a: { file?: File }) => {
      await flush();
      return a.file ? api.uploadPlotImage(p.id, 'avatar', a.file, c.id) : api.plotImage(p.id, 'avatar', c.id);
    },
    onSuccess: (np) => onServer(np),
  });
  const add = () => {
    const nc = normalizeCharacter({ id: newId(), name: `${T.character}${p.characters.length + 1}` });
    update((d) => void d.characters.push(nc));
    setSel(nc.id);
  };
  return (
    <div className="grid gap-5 md:grid-cols-[180px_1fr]">
      <div className="space-y-1">
        {p.characters.map((x) => (
          <button key={x.id} type="button" onClick={() => setSel(x.id)} className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', x.id === c?.id ? 'bg-panel2 text-gold' : 'text-dim hover:bg-panel hover:text-ink')}>
            {x.avatar ? <img src={imageUrl(x.avatar)} alt="" className="h-6 w-6 rounded-full object-cover" /> : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-panel2 text-[10px]">{x.name.slice(0, 1)}</span>}
            <span className="truncate">{x.name || '（名前なし）'}</span>
          </button>
        ))}
        <Button size="sm" variant="ghost" className="w-full" onClick={add}>
          <Icon name="plus" size={13} /> 追加
        </Button>
        <Link to={`/plots/${p.id}/wizard?view=cast`} onClick={() => void flush()} className="block">
          <Button size="sm" variant="ghost" className="w-full" title="AIと1人ずつ作る、作り直す">
            <Icon name="wand" size={13} /> {T.wizard}で作る
          </Button>
        </Link>
        <p className="px-1 pt-2 text-[11px] leading-relaxed text-faint">人数の上限はありません。人数が増えるほど送るトークンが増え、{T.illust}の精度は下がります。</p>
      </div>
      {!c ? (
        <Empty>{T.character}を追加してください</Empty>
      ) : (
        <div>
          <div className="mb-6 flex gap-5">
            <AvatarBox src={c.avatar} name={c.name} busy={img.isPending} onGenerate={() => img.mutate({})} onUpload={(file) => img.mutate({ file })} />
            {c.fullBody && (
              <a href={imageUrl(c.fullBody)} target="_blank" rel="noreferrer" title="立ち絵（AIと制作で最後に描いた全身）" className="shrink-0">
                <img src={imageUrl(c.fullBody)} alt="" className="aspect-[2/3] w-24 rounded-lg border border-line object-cover" />
              </a>
            )}
            <div className="flex-1 space-y-4">
              <Field label="名前">
                <Input value={c.name} onChange={(e) => set((x) => void (x.name = e.target.value))} />
              </Field>
              <ErrorText error={img.error} />
            </div>
          </div>
          <Field label="プロフィール" hint="口調、一人称、外見、人物像、主人公との関係など" className="mb-7">
            <TextArea rows={10} value={c.profile} onChange={(e) => set((x) => void (x.profile = e.target.value))} />
          </Field>
          <Section title={`${T.illust}の設定`} hint={`${T.illust}を作るときだけ使います。${T.wizard}では、${T.character}を作るときに一緒に作ります`}>
            <Card className="space-y-5 p-4">
              <IllustFields value={c.illust} onChange={(patch) => set((x) => void Object.assign(x.illust, patch))} />
              <div>
                <div className="mb-2 text-[13px] font-medium">初期の服装</div>
                <OutfitEditor value={c.illust.defaultOutfit} onChange={(o) => set((x) => void (x.illust.defaultOutfit = o))} />
              </div>
            </Card>
          </Section>
          <div className="flex justify-end">
            <ConfirmButton
              onConfirm={() => {
                update((d) => void d.characters.splice(idx, 1));
                setSel(p.characters[0]?.id ?? '');
              }}
            >
              <Icon name="trash" size={13} /> この{T.character}を消す
            </ConfirmButton>
          </div>
        </div>
      )}
    </div>
  );
}

function PlayersTab({ p, update }: { p: Plot; update: Update }) {
  return (
    <>
      <Section title={T.playerPosition} hint={`物語の中での${T.player}の立場だけを書きます。どの${T.player}で遊んでもプロンプトに入ります`}>
        <TextArea rows={4} value={p.playerPosition} onChange={(e) => update((d) => void (d.playerPosition = e.target.value))} placeholder="例 {{user}}は魔法研究会に入ったばかりの新入部員" />
      </Section>
      <Section
        title={T.player}
        hint={`複数入れると、遊び始めるときに選べます`}
        right={
          <Button size="sm" onClick={() => update((d) => void d.players.push(normalizePlayer({ id: newId(), name: `${T.player}${d.players.length + 1}` })))}>
            <Icon name="plus" size={13} /> 追加
          </Button>
        }
      >
        {p.players.length === 0 && <Empty>{T.player}はいません。遊ぶときは{T.you}の名前と性別になります</Empty>}
        <div className="space-y-4">
          {p.players.map((pl, i) => (
            <Card key={pl.id} className="p-4">
              <PlayerFields player={pl} onChange={(fn) => update((d) => fn(d.players[i]))} />
              <div className="mt-4 flex justify-end">
                <ConfirmButton onConfirm={() => update((d) => void d.players.splice(i, 1))}>
                  <Icon name="trash" size={13} /> 消す
                </ConfirmButton>
              </div>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}

function ExamplesTab({ p, update }: { p: Plot; update: Update }) {
  return (
    <Section title={T.examples} hint={`${T.character}の話し方の見本。任意です。システムの最後に入ります`}>
      <TextArea rows={16} value={p.examples} onChange={(e) => update((d) => void (d.examples = e.target.value))} placeholder={'例\n{{user}}「おはよう」\nひなた「おっはよー！今日も元気？」'} />
    </Section>
  );
}

function LoreTab({ p, update }: { p: Plot; update: Update }) {
  const qc = useQueryClient();
  const books = useQuery({ queryKey: ['lorebooks'], queryFn: api.lorebooks });
  const create = useMutation({
    mutationFn: () => api.createLorebook({ name: `${p.title || T.plot}の${T.lorebook}`, entries: [] }),
    onSuccess: (b) => {
      qc.invalidateQueries({ queryKey: ['lorebooks'] });
      update((d) => void d.lorebookIds.push(b.id));
    },
  });
  const linked = (books.data ?? []).filter((b) => !b.global);
  const global = (books.data ?? []).filter((b) => b.global);
  return (
    <>
      <Section
        title={`連動する${T.lorebook}`}
        hint="キーワードで発動する項目です。このシナリオで遊ぶときだけ使います。書き出しにも含まれます"
        right={
          <div className="flex gap-2">
            <Button size="sm" onClick={() => create.mutate()}>
              <Icon name="plus" size={13} /> 新しく作る
            </Button>
            <Link to="/lorebooks">
              <Button size="sm">編集する</Button>
            </Link>
          </div>
        }
      >
        {linked.length === 0 && <Empty>{T.lorebook}はまだありません</Empty>}
        <div className="space-y-1.5">
          {linked.map((b) => (
            <label key={b.id} className="flex cursor-pointer items-center gap-3 rounded-md border border-line bg-panel px-3 py-2">
              <input
                type="checkbox"
                className="accent-gold"
                checked={p.lorebookIds.includes(b.id)}
                onChange={(e) =>
                  update((d) => {
                    d.lorebookIds = e.target.checked ? [...d.lorebookIds, b.id] : d.lorebookIds.filter((x) => x !== b.id);
                  })
                }
              />
              <span className="flex-1">{b.name || '（無題）'}</span>
              <span className="text-xs text-faint">{b.entries.length}項目</span>
            </label>
          ))}
        </div>
      </Section>
      {global.length > 0 && (
        <Section title={`全チャット共通の${T.lorebook}`} hint="どのシナリオでも常に使われます">
          <div className="flex flex-wrap gap-2">
            {global.map((b) => (
              <Badge key={b.id}>{b.name}</Badge>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

function IntrosTab({ p, update }: { p: Plot; update: Update }) {
  return (
    <>
      {p.intros.map((it, i) => (
        <Section
          key={i}
          title={`${T.intro} ${i + 1}`}
          hint={i === 0 ? `最初の場面です。複数用意すると、チャットを始めるときに選べます。{{user}} が使えます。「名前「セリフ」」の行は吹き出しになります` : undefined}
          right={
            p.intros.length > 1 && (
              <ConfirmButton onConfirm={() => update((d) => void d.intros.splice(i, 1))}>
                <Icon name="trash" size={13} />
              </ConfirmButton>
            )
          }
        >
          <div className="space-y-4">
            <TextArea rows={7} value={it.text} onChange={(e) => update((d) => void (d.intros[i].text = e.target.value))} />
            <Card className="space-y-4 p-4">
              <div className="text-[13px] font-medium">場面の初期値</div>
              <Field label="その場にいる人" hint="選ばなければ全員">
                <div className="flex flex-wrap gap-3">
                  {p.characters.map((c) => (
                    <label key={c.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        className="accent-gold"
                        checked={it.present?.includes(c.id) ?? false}
                        onChange={(e) =>
                          update((d) => {
                            const cur = d.intros[i].present ?? [];
                            d.intros[i].present = e.target.checked ? [...cur, c.id] : cur.filter((x) => x !== c.id);
                          })
                        }
                      />
                      {c.name}
                    </label>
                  ))}
                </div>
              </Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="場所">
                  <Input value={it.location?.name ?? ''} placeholder="例 部室" onChange={(e) => update((d) => void (d.intros[i].location = { name: e.target.value, tags: d.intros[i].location?.tags ?? '' }))} />
                </Field>
                <Field label="場所の背景タグ" hint="英語。空なら最初の挿絵で作ります">
                  <Input value={it.location?.tags ?? ''} placeholder="例 clubroom, indoors, bookshelf" onChange={(e) => update((d) => void (d.intros[i].location = { name: d.intros[i].location?.name ?? '', tags: e.target.value }))} />
                </Field>
                <Field label="時間帯">
                  <Input value={it.time ?? ''} placeholder="例 夕方" onChange={(e) => update((d) => void (d.intros[i].time = e.target.value))} />
                </Field>
                <Field label="天気">
                  <Input value={it.weather ?? ''} placeholder="例 晴れ" onChange={(e) => update((d) => void (d.intros[i].weather = e.target.value))} />
                </Field>
              </div>
              <div>
                <div className="mb-2 text-[13px] font-medium">服装</div>
                <p className="mb-2 text-xs text-faint">変えなければ各{T.character}の初期の服装から始まります</p>
                <div className="space-y-2">
                  {p.characters.map((c) => {
                    const o = it.outfits?.[c.id];
                    return (
                      <details key={c.id} className="rounded-md border border-line bg-panel2 px-3 py-2" open={!!o}>
                        <summary className="cursor-pointer text-sm">
                          {c.name}
                          {o ? <span className="ml-2 text-xs text-gold">この{T.intro}だけの服装</span> : <span className="ml-2 text-xs text-faint">初期の服装</span>}
                        </summary>
                        <div className="mt-2">
                          <OutfitEditor
                            value={o ?? c.illust.defaultOutfit}
                            onChange={(no) =>
                              update((d) => {
                                d.intros[i].outfits = { ...(d.intros[i].outfits ?? {}), [c.id]: no };
                              })
                            }
                          />
                          {o && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="mt-1"
                              onClick={() =>
                                update((d) => {
                                  const rest = { ...(d.intros[i].outfits ?? {}) };
                                  delete rest[c.id];
                                  d.intros[i].outfits = rest;
                                })
                              }
                            >
                              初期の服装に戻す
                            </Button>
                          )}
                        </div>
                      </details>
                    );
                  })}
                </div>
              </div>
            </Card>
          </div>
        </Section>
      ))}
      <Button onClick={() => update((d) => void d.intros.push({ text: '' }))}>
        <Icon name="plus" /> {T.intro}を足す
      </Button>
    </>
  );
}

function IllustTab({ p, update }: { p: Plot; update: Update }) {
  return (
    <>
      <Section title="画風">
        <Field label="画風タグ" hint="例 @artist name, watercolor。挿絵、アバター、サムネイルのすべてに入ります">
          <Input value={p.style.styleTags} onChange={(e) => update((d) => void (d.style.styleTags = e.target.value))} />
        </Field>
      </Section>
    </>
  );
}

function ListingTab({ p, update, flush, onServer }: { p: Plot; update: Update; flush: () => Promise<void>; onServer: (p: Plot) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const sitePosts = useQuery({ queryKey: ['sitePosts'], queryFn: api.sitePosts, enabled: !!settings.data?.site.connected, retry: false });
  const [posting, setPosting] = useState(false);
  // 投稿は保存した中身を送るので、先に保存してから開く
  const openPost = useMutation({ mutationFn: flush, onSuccess: () => setPosting(true) });
  const img = useMutation({
    mutationFn: async (a: { file?: File }) => {
      await flush();
      return a.file ? api.uploadPlotImage(p.id, 'cover', a.file) : api.plotImage(p.id, 'cover');
    },
    onSuccess: onServer,
  });
  return (
    <>
      <Section title={T.cover} hint="アプリ内の一覧と投稿サイトで使います。縦長の1024×1536（2:3）で作ります。手持ちの画像もこの比率がおすすめです（違う比率は端が切れて表示されます）">
        <div className="flex items-start gap-4">
          <div className="relative aspect-[2/3] w-48 overflow-hidden rounded-lg border border-line bg-panel2">
            {p.listing.cover ? <img src={imageUrl(p.listing.cover)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-faint"><Icon name="image" size={28} /></div>}
            {img.isPending && (
              <div className="absolute inset-0 flex items-center justify-center bg-panel/70">
                <Spinner />
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Button onClick={() => img.mutate({})} disabled={img.isPending || p.characters.length === 0}>
              <Icon name="sparkle" /> ComfyUIで作る
            </Button>
            <Button onClick={() => ref.current?.click()} disabled={img.isPending}>
              <Icon name="upload" /> 画像を選ぶ
            </Button>
            <input
              ref={ref}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) img.mutate({ file: f });
                e.target.value = '';
              }}
            />
            <ErrorText error={img.error} />
          </div>
        </div>
      </Section>
      <div className="space-y-4">
        <Field label="一言紹介">
          <Input value={p.listing.tagline} onChange={(e) => update((d) => void (d.listing.tagline = e.target.value))} />
        </Field>
        <Field label="ハッシュタグ" hint="Enterで区切ります">
          <TagsInput value={p.listing.hashtags} onChange={(v) => update((d) => void (d.listing.hashtags = v))} placeholder="例 学園, ファンタジー" />
        </Field>
        <Field label="紹介文">
          <TextArea rows={6} value={p.listing.intro} onChange={(e) => update((d) => void (d.listing.intro = e.target.value))} />
        </Field>
        <Field label="作者コメント">
          <TextArea rows={3} value={p.listing.creatorComment} onChange={(e) => update((d) => void (d.listing.creatorComment = e.target.value))} />
        </Field>
        <Field label={T.rating} hint={`投稿サイトと同じ区分です。一覧とシナリオの画面に札が出るだけで、会話と${T.illust}には影響しません`}>
          <Segmented value={p.listing.rating} onChange={(v) => update((d) => void (d.listing.rating = v))} options={(['all', 'r18', 'r18g'] as const).map((v) => ({ value: v, label: RATING_LABELS[v] }))} />
        </Field>
        <Field label="元作品名" hint="二次創作のときに、元の漫画やゲームの名前を入れます。オリジナルなら空のままにします">
          <Input value={p.listing.sourceTitle ?? ''} onChange={(e) => update((d) => void (d.listing.sourceTitle = e.target.value))} />
        </Field>
        {p.origin && (
          <p className="text-xs text-dim">
            元の{T.plot}: {p.origin.title || '（無題）'}（{p.origin.authorName || '作者不明'}）。手直しして投稿すると、元の{T.plot}として表示されます
          </p>
        )}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" onClick={() => openPost.mutate()} disabled={openPost.isPending}>
          <Icon name="send" /> {p.posted ? '投稿を更新' : '投稿する'}
        </Button>
        <span className="text-xs text-faint">{T.site}に投稿します。公開の範囲は、次の画面で選びます</span>
        <ErrorText error={openPost.error} />
      </div>
      {posting && <PostDialog item={plotPostItem(p)} sitePost={p.posted ? sitePosts.data?.posts.find((x) => x.id === p.posted!.postId) : undefined} onClose={() => setPosting(false)} />}
    </>
  );
}
