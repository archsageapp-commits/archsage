import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { USER_ID, type Chat, type ImageRef, type Player, type SceneState } from '@archsage/shared';
import { api, type ChatView } from '../api.ts';
import { ChatMessage, Parts, type People } from '../components/ChatMessage.tsx';
import { InfoBox } from '../components/InfoBox.tsx';
import { Lightbox, type LightboxItem } from '../components/Lightbox.tsx';
import { PreviewModal } from '../components/PreviewModal.tsx';
import { clearDraft, type Draft } from '../events.ts';
import { MODE_LABELS, T } from '../terms.ts';
import { Button, cx, ErrorText, Icon, Input, Spinner, TextArea } from '../ui.tsx';

const FALLBACK: Player = { id: 'default', name: 'あなた', description: '', sex: 'male', countTag: '1boy' };

export function ChatPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const view = useQuery({ queryKey: ['chat', id], queryFn: () => api.chat(id) });
  const chat = view.data?.chat;
  const plot = useQuery({ queryKey: ['plot', chat?.plotId], queryFn: () => api.plot(chat!.plotId), enabled: !!chat });
  // 書いている途中の返答。イベントで届いたものを置くだけで、取りには行かない
  const draft = useQuery<Draft | null>({ queryKey: ['draft', id], queryFn: () => null, enabled: false, initialData: null }).data;

  const [text, setText] = useState('');
  const [instruction, setInstruction] = useState('');
  const [showInstruction, setShowInstruction] = useState(false);
  const [panel, setPanel] = useState(true);
  const [preview, setPreview] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const setView = (v: ChatView) => qc.setQueryData(['chat', id], v);

  const player = view.data?.player ?? FALLBACK;

  const people: People = useMemo(
    () => ({
      nameOf: (pid: string) => (pid === USER_ID ? player.name : (plot.data?.characters.find((c) => c.id === pid)?.name ?? pid)),
      avatarOf: (pid: string) => (pid === USER_ID ? undefined : plot.data?.characters.find((c) => c.id === pid)?.avatar),
      playerName: player.name,
    }),
    [plot.data, player],
  );

  const gen = useMutation({
    mutationFn: (body: { text?: string; instruction?: string; regenerate?: boolean }) => api.generate(id, body),
    onMutate: () => {
      stick.current = true;
    },
    onSuccess: (v) => {
      setView(v);
      clearDraft(qc, id);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['chat', id] }),
  });
  const stop = useMutation({ mutationFn: () => api.stopGenerate(id) });
  const patchMsg = useMutation({
    mutationFn: (a: { mid: string; patch: { activeSwipe?: number; text?: string; instruction?: string; state?: SceneState } }) => api.patchMessage(id, a.mid, a.patch),
    onSuccess: setView,
  });
  const delMsg = useMutation({ mutationFn: (a: { mid: string; swipe?: number }) => api.deleteMessage(id, a.mid, a.swipe), onSuccess: setView });
  const illus = useMutation({
    mutationFn: (a: { mid: string; swipe: number; reseedImageId?: string }) => api.illustrate(id, a.mid, { swipe: a.swipe, reseedImageId: a.reseedImageId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chat', id] }),
  });
  const delImg = useMutation({ mutationFn: (a: { mid: string; img: string }) => api.deleteImage(id, a.mid, a.img), onSuccess: setView });
  const patchChat = useMutation({
    mutationFn: (patch: Partial<Chat>) => api.patchChat(id, patch),
    onMutate: (patch) => {
      qc.setQueryData<ChatView>(['chat', id], (v) => (v ? { ...v, chat: { ...v.chat, ...patch } } : v));
    },
    onSuccess: (c) => qc.setQueryData<ChatView>(['chat', id], (v) => (v ? { ...v, chat: c } : v)),
  });
  const summary = useMutation({
    mutationFn: (a: { kind: 'save'; id: string; text: string } | { kind: 'redo'; id: string } | { kind: 'delete'; id: string }) =>
      a.kind === 'save' ? api.saveSummary(id, a.id, a.text) : a.kind === 'redo' ? api.redoSummary(id, a.id) : api.deleteSummary(id, a.id),
    onSuccess: setView,
  });

  const messages = view.data?.messages ?? [];
  const busy = gen.isPending || !!view.data?.busy;

  // 最新の状態と、その前の状態（変わった欄の強調に使う）
  const stateIdx = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) if (messages[i].swipes[messages[i].activeSwipe]?.state) return i;
    return -1;
  }, [messages]);
  const state = stateIdx >= 0 ? messages[stateIdx].swipes[messages[stateIdx].activeSwipe].state : undefined;
  const prevState = useMemo(() => {
    for (let i = stateIdx - 1; i >= 0; i--) {
      const s = messages[i].swipes[messages[i].activeSwipe]?.state;
      if (s) return s;
    }
    return undefined;
  }, [messages, stateIdx]);

  const gallery: (LightboxItem & { id: string })[] = useMemo(
    () =>
      messages.flatMap((m) =>
        (m.swipes[m.activeSwipe]?.images ?? [])
          .filter((i) => i.status === 'done' && i.file)
          .map((i) => ({ id: i.id, file: i.file as string, prompt: i.prompt, negative: i.negative, seed: i.seed })),
      ),
    [messages],
  );

  useEffect(() => {
    const el = listRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy, draft]);

  const send = () => {
    if (busy) return;
    const t = text.trim();
    const ins = instruction.trim();
    gen.mutate({ text: t || undefined, instruction: ins || undefined });
    setText('');
    setInstruction('');
    setShowInstruction(false);
  };

  if (!view.data || !plot.data) {
    return <div className="p-6">{view.error || plot.error ? <ErrorText error={view.error ?? plot.error} /> : <Spinner />}</div>;
  }
  const c = view.data.chat;
  const lastIdx = messages.length - 1;

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
          <Link to={`/plots/${plot.data.id}`} className="text-dim hover:text-ink" title={`${T.plot}へ`}>
            <Icon name="left" />
          </Link>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{c.title || plot.data.title}</div>
            <div className="text-[11px] text-faint">
              {MODE_LABELS[c.mode]}・{player.name}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => setPreview(true)}>
            <Icon name="eye" size={14} /> {T.preview}
          </Button>
          <Button size="sm" variant={panel ? 'subtle' : 'ghost'} onClick={() => setPanel(!panel)} title={T.infobox}>
            <Icon name="panel" size={14} />
          </Button>
        </div>

        <div
          ref={listRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(e) => {
            const el = e.currentTarget;
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto max-w-3xl space-y-7 px-5 py-6">
            {messages.map((m, i) => {
              // 導入が空なら何も出さない（場面の初期値だけを持つ）
              const sw = m.swipes[m.activeSwipe];
              if (i === 0 && m.role === 'assistant' && !sw?.text.trim() && !sw?.images.length && !sw?.error) return null;
              return (
              <ChatMessage
                key={m.id}
                message={m}
                people={people}
                novel={view.data?.chat.mode === 'novel'}
                busy={busy}
                canRegenerate={i === lastIdx && m.role === 'assistant' && i > 0}
                onSwipe={(s) => patchMsg.mutate({ mid: m.id, patch: { activeSwipe: s } })}
                onRegenerate={() => gen.mutate({ regenerate: true })}
                onEdit={(t, ins) => patchMsg.mutate({ mid: m.id, patch: { text: t, instruction: ins } })}
                onDelete={(s) => delMsg.mutate({ mid: m.id, swipe: s })}
                onIllustrate={() => illus.mutate({ mid: m.id, swipe: m.activeSwipe })}
                onReseed={(img: ImageRef) => illus.mutate({ mid: m.id, swipe: m.activeSwipe, reseedImageId: img.id })}
                onDeleteImage={(img: ImageRef) => delImg.mutate({ mid: m.id, img: img.id })}
                onOpenImage={(file) => setLightbox(Math.max(0, gallery.findIndex((g) => g.file === file)))}
                onImageLoad={() => {
                  const el = listRef.current;
                  if (el && stick.current) el.scrollTop = el.scrollHeight;
                }}
              />
              );
            })}
            {busy && draft && draft.parts.length > 0 && (
              <div className="opacity-90">
                <Parts parts={draft.parts} people={people} />
              </div>
            )}
            {busy && (
              <div className="flex items-center gap-2 text-sm text-dim">
                <Spinner className="h-3.5 w-3.5 text-gold" /> {draft?.thinking ? '考えています…' : '返答を書いています…'}
              </div>
            )}
            <ErrorText error={gen.error ?? illus.error ?? patchMsg.error ?? delMsg.error} />
          </div>
        </div>

        <div className="border-t border-line bg-shade px-4 py-3">
          <div className="mx-auto max-w-3xl space-y-2">
            {/* 展開の指示は、名前と中身が見えるように入力欄の上に出す。開いていなくても、入れた指示は札で見せる */}
            {showInstruction ? (
              <div className="rounded-lg border border-gold/40 bg-gold/5 p-2.5">
                <div className="mb-1.5 flex items-center gap-2">
                  <Icon name="wand" size={13} className="text-gold" />
                  <span className="text-xs font-medium text-gold-soft">{T.instruction}</span>
                  <span className="text-[11px] text-faint">次の返答だけに効きます（作り直すときも同じ指示を使います）</span>
                  <button type="button" className="ml-auto text-faint hover:text-ink" onClick={() => setShowInstruction(false)} title="閉じる（入れた指示は残ります）">
                    <Icon name="x" size={14} />
                  </button>
                </div>
                <Input
                  autoFocus
                  className="h-8 text-sm"
                  value={instruction}
                  placeholder="例 場面を夜に進めて／しずくが秘密を打ち明ける"
                  onChange={(e) => setInstruction(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) send();
                  }}
                />
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowInstruction(true)}
                  className={cx(
                    'flex h-7 max-w-full items-center gap-1.5 rounded-full border px-3 text-xs transition-colors',
                    instruction.trim() ? 'border-gold/50 bg-gold/10 text-gold-soft' : 'border-line text-dim hover:border-line-strong hover:text-ink',
                  )}
                >
                  <Icon name="wand" size={12} />
                  {instruction.trim() ? <span className="truncate">{T.instruction}: {instruction.trim()}</span> : <span>{T.instruction}を付ける</span>}
                </button>
                {instruction.trim() && (
                  <button type="button" className="text-faint hover:text-ink" onClick={() => setInstruction('')} title="展開の指示を消す">
                    <Icon name="x" size={13} />
                  </button>
                )}
              </div>
            )}
            <div className="flex items-end gap-2">
              <TextArea
                rows={1}
                autoGrow
                value={text}
                placeholder={c.mode === 'novel' ? 'どう進めるかを書く（空のまま送ると続きを書きます）' : `${player.name}として話す（Ctrl+Enterで送る。空のまま送ると続きを書きます）`}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    send();
                  }
                }}
              />
              {busy ? (
                <Button className="h-[42px] w-12" onClick={() => stop.mutate()} disabled={stop.isPending} title="止める（書けたところまでを残します）">
                  <Icon name="stop" />
                </Button>
              ) : (
                <Button variant="primary" className={cx('h-[42px] w-12')} onClick={send}>
                  <Icon name="send" />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {panel && (
        <aside className="w-[360px] shrink-0 border-l border-line bg-shade">
          <InfoBox
            plot={plot.data}
            player={player}
            chat={c}
            state={state}
            prevState={prevState}
            summaries={view.data.summaries}
            onState={(s) => stateIdx >= 0 && patchMsg.mutate({ mid: messages[stateIdx].id, patch: { state: s } })}
            onChat={(patch) => patchChat.mutate(patch)}
            onSummary={(a) => summary.mutate(a)}
          />
        </aside>
      )}

      {preview && <PreviewModal chatId={id} open={preview} onClose={() => setPreview(false)} text={text} instruction={instruction} />}
      {lightbox !== null && gallery.length > 0 && <Lightbox items={gallery} index={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}
