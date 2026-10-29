import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { normalizeSafety, renderTemplate, SAFETY_TAGS, type ChatMode, type PlayerRef, type Safety, type StyleSettings, type UserMode } from '@archsage/shared';
import { api, imageUrl } from '../api.ts';
import { StyleFields } from '../components/Fields.tsx';
import { PostDialog, plotPostItem } from '../components/PostDialog.tsx';
import { Page } from '../Layout.tsx';
import { MODE_LABELS, RATING_LABELS, SAFETY_LABELS, T, USER_MODE_LABELS } from '../terms.ts';
import { Badge, Button, Card, ConfirmButton, ErrorText, Field, Icon, Segmented, Select, Toggle } from '../ui.tsx';

export function PlotPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const nav = useNavigate();
  const plot = useQuery({ queryKey: ['plot', id], queryFn: () => api.plot(id) });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const chats = useQuery({ queryKey: ['chats', id], queryFn: () => api.chats(id) });
  const comfy = useQuery({ queryKey: ['comfyStatus'], queryFn: () => api.comfyStatus() });
  // つながっていれば、この作品の投稿の状態を取る
  const sitePosts = useQuery({ queryKey: ['sitePosts'], queryFn: api.sitePosts, enabled: !!settings.data?.site.connected, retry: false });
  const [posting, setPosting] = useState(false);

  const [introIndex, setIntroIndex] = useState(0);
  const [player, setPlayer] = useState<string>('');
  // シナリオの主人公を、名前だけ「あなた」にして遊ぶか。前に選んだ方を覚えておく
  const [asYou, setAsYou] = useState<boolean>(() => {
    try {
      return localStorage.getItem('archsage.playAsYou') !== '0';
    } catch {
      return true;
    }
  });
  const chooseAsYou = (v: boolean) => {
    setAsYou(v);
    try {
      localStorage.setItem('archsage.playAsYou', v ? '1' : '0');
    } catch {
      // 覚えられなくても遊べる
    }
  };
  const [safety, setSafety] = useState<Safety>('safe');
  const [userMode, setUserMode] = useState<UserMode>('exclude');
  const [mode, setMode] = useState<ChatMode>('rp');
  const [auto, setAuto] = useState(true);
  const [style, setStyle] = useState<StyleSettings | null>(null);

  const p = plot.data;
  useEffect(() => {
    if (!p) return;
    setSafety(p.style.defaultSafety);
    setUserMode(p.style.defaultUserMode);
    const { replyFormat, length, dialogueRatio, pace, person } = p.style;
    setStyle({ replyFormat, length, dialogueRatio, pace, person });
  }, [p]);
  useEffect(() => {
    if (comfy.data) setAuto(comfy.data.ok);
  }, [comfy.data]);

  const playerOptions = useMemo(() => {
    const list: { key: string; ref: PlayerRef; label: string }[] = [];
    for (const x of p?.players ?? []) list.push({ key: `plot:${x.id}`, ref: { source: 'plot', id: x.id }, label: x.name });
    // 主人公のいないシナリオは「あなた」で遊ぶ
    if (p && !p.players.length) list.push({ key: 'you', ref: { source: 'you', id: 'you' }, label: `${settings.data?.you.name || T.you}（${T.you}）` });
    return list;
  }, [p, settings.data]);
  useEffect(() => {
    if (!player && playerOptions[0]) setPlayer(playerOptions[0].key);
  }, [player, playerOptions]);

  // 遊び始めるときに選んだ挿絵のレーティング、映り方、文体は、このシナリオの次の既定値として残す
  const start = useMutation({
    mutationFn: async () => {
      if (p && style) {
        const next = { ...p.style, ...style, defaultSafety: safety, defaultUserMode: userMode };
        if (JSON.stringify(next) !== JSON.stringify(p.style)) qc.setQueryData(['plot', id], await api.savePlot({ ...p, style: next }));
      }
      return api.createChat({
        plotId: id,
        introIndex,
        player: chosenRef,
        safety,
        userMode,
        mode,
        autoIllustrate: auto,
        // あとで既定値を変えても、このチャットの文体は変わらないようにする
        styleOverride: style ?? undefined,
      });
    },
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['chats'] });
      nav(`/chats/${v.chat.id}`);
    },
  });
  const dup = useMutation({
    mutationFn: () => api.duplicatePlot(id),
    onSuccess: (np) => {
      qc.invalidateQueries({ queryKey: ['plots'] });
      nav(`/plots/${np.id}/edit`);
    },
  });
  const del = useMutation({
    mutationFn: () => api.deletePlot(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plots'] });
      qc.invalidateQueries({ queryKey: ['chats'] });
      nav('/');
    },
  });
  const delChat = useMutation({
    mutationFn: (cid: string) => api.deleteChat(cid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chats'] }),
  });

  const youName = settings.data?.you.name.trim() ?? '';
  const selectedRef = playerOptions.find((o) => o.key === player)?.ref;
  const playingAsYou = selectedRef?.source === 'plot' && asYou && !!youName;
  const chosenRef: PlayerRef | undefined = selectedRef && playingAsYou ? { ...selectedRef, asYou: true } : selectedRef;

  if (!p) return <Page title="…">{plot.error ? <ErrorText error={plot.error} /> : null}</Page>;
  const intro = p.intros[introIndex];
  const userName = playingAsYou ? youName : (playerOptions.find((o) => o.key === player)?.label.replace(/（.*）$/, '') ?? 'あなた');
  const fill = (t: string) => renderTemplate(t, { user: userName, char: p.characters.map((c) => c.name).join('、') });

  return (
    <Page
      title={p.title || '（無題）'}
      actions={
        <>
          <Link to={`/plots/${id}/edit`}>
            <Button>
              <Icon name="edit" /> 編集
            </Button>
          </Link>
          <Button onClick={() => setPosting(true)}>
            <Icon name="send" /> {p.posted ? '投稿を更新' : '投稿する'}
          </Button>
          <a href={api.exportUrl(id)}>
            <Button>
              <Icon name="download" /> 書き出す
            </Button>
          </a>
          <Button onClick={() => dup.mutate()}>
            <Icon name="copy" /> 複製
          </Button>
          <ConfirmButton size="md" onConfirm={() => del.mutate()}>
            <Icon name="trash" /> 削除
          </ConfirmButton>
        </>
      }
    >
      {posting && <PostDialog item={plotPostItem(p)} sitePost={p.posted ? sitePosts.data?.posts.find((x) => x.id === p.posted!.postId) : undefined} onClose={() => setPosting(false)} />}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          {p.listing.cover && <img src={imageUrl(p.listing.cover)} alt="" className="aspect-[2/3] w-full max-w-sm rounded-lg border border-line object-cover" />}
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={p.listing.rating === 'all' ? 'dim' : 'danger'}>{RATING_LABELS[p.listing.rating]}</Badge>
            {p.listing.hashtags.map((h) => (
              <span key={h} className="text-xs text-gold/80">
                #{h}
              </span>
            ))}
          </div>
          {p.listing.tagline && <p className="text-base text-ink/90">{p.listing.tagline}</p>}
          {(p.listing.intro || p.story) && <p className="whitespace-pre-wrap text-sm leading-relaxed text-dim">{fill(p.listing.intro || p.story)}</p>}
          {p.characters.length > 0 && (
            <div>
              <h2 className="mb-2 text-sm font-semibold text-dim">{T.character}</h2>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
                {p.characters.map((c) => (
                  <Card key={c.id} className="flex gap-3 p-3">
                    {c.avatar ? (
                      <img src={imageUrl(c.avatar)} alt="" className="h-14 w-14 shrink-0 rounded-full object-cover" />
                    ) : (
                      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-panel2 text-lg">{c.name.slice(0, 1)}</div>
                    )}
                    <div className="min-w-0">
                      <div className="font-medium">{c.name}</div>
                      <div className="line-clamp-3 text-xs text-dim">{fill(c.profile)}</div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
          {p.listing.creatorComment && (
            <div className="rounded-lg border border-line bg-panel px-4 py-3 text-sm">
              <div className="mb-1 text-xs text-faint">作者コメント</div>
              <div className="whitespace-pre-wrap">{p.listing.creatorComment}</div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card className="space-y-4 p-4">
            <h2 className="font-semibold">遊び始める</h2>
            {p.intros.length > 1 && (
              <Field label={T.intro}>
                <Select value={introIndex} onChange={(e) => setIntroIndex(Number(e.target.value))}>
                  {p.intros.map((it, i) => (
                    <option key={i} value={i}>
                      {i + 1}. {it.text.split('\n')[0].slice(0, 30) || '（空）'}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {intro?.text && <div className="max-h-32 overflow-y-auto rounded-md bg-panel2 px-3 py-2 text-xs whitespace-pre-wrap text-dim">{fill(intro.text)}</div>}
            <Field label={T.player} hint={player === 'you' ? `この${T.plot}には${T.player}がいないので、${T.you}の名前と性別で遊びます。顔は描きません` : undefined}>
              <Select value={player} onChange={(e) => setPlayer(e.target.value)}>
                {playerOptions.length === 0 && <option value="">（{T.player}がいません）</option>}
                {playerOptions.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </Select>
              {selectedRef?.source === 'plot' && (
                <div className="mt-2 space-y-1">
                  <Toggle checked={playingAsYou} disabled={!youName} onChange={chooseAsYou} label={`${youName || T.you}（${T.you}）として遊ぶ`} />
                  <p className="text-xs text-faint">
                    {youName ? (
                      `名前だけ「${youName}」にします。性別、立場、服装はこの${T.player}のままで、${T.illust}では顔を描きません。`
                    ) : (
                      <>
                        <Link to="/settings" className="text-gold/80 hover:text-gold">
                          設定
                        </Link>
                        で{T.you}の名前を入れると選べます。
                      </>
                    )}
                  </p>
                </div>
              )}
            </Field>
            <Field label="進め方">
              <Segmented value={mode} onChange={setMode} options={(['rp', 'novel'] as const).map((v) => ({ value: v, label: MODE_LABELS[v] }))} />
            </Field>
            <Field label={T.safety} hint="挿絵だけに使います。会話には入りません">
              <Select value={normalizeSafety(safety)} onChange={(e) => setSafety(e.target.value as Safety)}>
                {(Object.keys(SAFETY_LABELS) as Safety[]).map((s) => (
                  <option key={s} value={s}>
                    {SAFETY_LABELS[s]}（{SAFETY_TAGS[s].join(', ')}）
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={T.userMode}>
              <Segmented value={userMode} onChange={setUserMode} options={(['include', 'pov', 'exclude'] as const).map((v) => ({ value: v, label: USER_MODE_LABELS[v] }))} />
            </Field>
            {style && (
              <div className="space-y-2 border-t border-line pt-4">
                <div className="text-[13px] font-medium">{T.style}</div>
                <StyleFields value={style} onChange={(patch) => setStyle({ ...style, ...patch })} />
              </div>
            )}
            <p className="text-xs text-faint">ここで選んだものは、次に遊ぶときの初めの値になります。遊んでいる途中でも、チャットの設定で変えられます。</p>
            <Toggle checked={auto} onChange={setAuto} label={`返答ごとに${T.illust}を作る`} disabled={comfy.data && !comfy.data.ok} />
            {comfy.data && !comfy.data.ok && <div className="text-xs text-faint">ComfyUIにつながらないため、{T.illust}は作れません</div>}
            <ErrorText error={start.error} />
            <Button variant="primary" className="w-full" onClick={() => start.mutate()} disabled={start.isPending || p.characters.length === 0}>
              <Icon name="play" /> はじめる
            </Button>
            {p.characters.length === 0 && <div className="text-xs text-faint">{T.character}がいないため始められません。編集から追加してください</div>}
          </Card>

          {chats.data && chats.data.length > 0 && (
            <Card className="p-2">
              <div className="px-2 py-1.5 text-xs font-semibold text-dim">このシナリオのチャット</div>
              {chats.data.map((c) => (
                <div key={c.id} className="group flex items-center gap-2 rounded px-2 py-1.5 hover:bg-panel2">
                  <Link to={`/chats/${c.id}`} className="min-w-0 flex-1 truncate text-sm">
                    {c.title || '（無題）'}
                    <span className="ml-2 text-xs text-faint">{new Date(c.updatedAt).toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                  </Link>
                  <ConfirmButton variant="ghost" className="opacity-0 group-hover:opacity-100" onConfirm={() => delChat.mutate(c.id)} confirmLabel="消す？">
                    <Icon name="trash" />
                  </ConfirmButton>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </Page>
  );
}
