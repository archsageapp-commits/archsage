import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  USER_ID,
  diffOutfit,
  emptyOutfit,
  exposedParts,
  resolveStyle,
  type Chat,
  type Plot,
  type Player,
  type Preset,
  normalizeSafety,
  SAFETY_TAGS,
  type Safety,
  type SceneState,
  type Sex,
  type Summary,
  type UserMode,
} from '@archsage/shared';
import { api } from '../api.ts';
import { StyleFields } from './Fields.tsx';
import { MODE_LABELS, SAFETY_LABELS, T, USER_MODE_LABELS } from '../terms.ts';
import { Badge, Button, ConfirmButton, cx, Field, Icon, Input, Segmented, Select, Tabs, TextArea, Toggle } from '../ui.tsx';
import { OutfitEditor } from './OutfitEditor.tsx';

function Row({ label, children, right, changed }: { label: string; children: ReactNode; right?: ReactNode; changed?: boolean }) {
  return (
    <div className={cx('rounded-md px-2 py-1.5', changed && 'bg-gold/8 ring-1 ring-gold/25')}>
      <div className="mb-1 flex items-center justify-between text-[11px] text-faint">
        <span>{label}</span>
        <span className="flex items-center gap-1.5">{right}</span>
      </div>
      {children}
    </div>
  );
}

const sm = 'h-7 text-xs';

export function InfoBox({
  plot,
  player,
  chat,
  state,
  prevState,
  summaries,
  onState,
  onChat,
  onSummary,
}: {
  plot: Plot;
  player: Player;
  chat: Chat;
  state: SceneState | undefined;
  prevState: SceneState | undefined;
  summaries: Summary[];
  onState: (s: SceneState) => void;
  onChat: (patch: Partial<Chat>) => void;
  onSummary: (a: { kind: 'save'; id: string; text: string } | { kind: 'redo'; id: string } | { kind: 'delete'; id: string }) => void;
}) {
  const [tab, setTab] = useState<'state' | 'settings' | 'summary'>('state');
  const presets = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  // 入力中はサーバーからの値で上書きしない
  const [local, setLocal] = useState<SceneState | undefined>(state);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef(false);
  useEffect(() => {
    if (!pending.current) setLocal(state);
  }, [state]);

  const edit = (fn: (s: SceneState) => void) => {
    if (!local) return;
    const next = structuredClone(local);
    fn(next);
    setLocal(next);
    pending.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      pending.current = false;
      onState(next);
    }, 700);
  };


  const people: { id: string; name: string; sex: Sex }[] = [
    ...plot.characters.filter((c) => local?.present.includes(c.id)).map((c) => ({ id: c.id, name: c.name, sex: c.illust.sex })),
    { id: USER_ID, name: player.name, sex: player.sex },
  ];
  const [personTab, setPersonTab] = useState<string>('');
  const person = people.find((p) => p.id === personTab) ?? people[0];
  const style = resolveStyle(plot.style, chat.styleOverride);

  return (
    <div className="flex h-full flex-col">
      <Tabs
        className="px-2"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'state', label: T.infobox },
          { key: 'settings', label: 'チャットの設定' },
          { key: 'summary', label: `${T.summary}${summaries.length ? `（${summaries.length}）` : ''}` },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {tab === 'state' &&
          (!local ? (
            <div className="text-sm text-dim">まだ状況がありません</div>
          ) : (
            <div className="space-y-2">
              <Row label="その場にいる人" changed={!!prevState && prevState.present.join() !== local.present.join()}>
                <div className="flex flex-wrap gap-1.5">
                  {plot.characters.map((c) => {
                    const on = local.present.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => edit((s) => void (s.present = on ? s.present.filter((x) => x !== c.id) : [...s.present, c.id]))}
                        className={cx('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-gold/40 bg-gold/10 text-gold' : 'border-line text-faint hover:text-ink')}
                      >
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </Row>
              <Row label="場所" changed={!!prevState && JSON.stringify(prevState.location ?? null) !== JSON.stringify(local.location ?? null)}>
                <div className="space-y-1">
                  <Input className={sm} value={local.location?.name ?? ''} placeholder="場所の名前" onChange={(e) => edit((s) => void (s.location = { name: e.target.value, tags: s.location?.tags ?? '' }))} />
                  <Input className={sm} value={local.location?.tags ?? ''} placeholder="背景タグ（英語）" onChange={(e) => edit((s) => void (s.location = { name: s.location?.name ?? '', tags: e.target.value }))} />
                </div>
              </Row>
              <div className="grid grid-cols-2 gap-2">
                <Row label="時間帯" changed={!!prevState && prevState.time !== local.time}>
                  <Input className={sm} value={local.time ?? ''} onChange={(e) => edit((s) => void (s.time = e.target.value))} />
                </Row>
                <Row label="天気" changed={!!prevState && prevState.weather !== local.weather}>
                  <Input className={sm} value={local.weather ?? ''} onChange={(e) => edit((s) => void (s.weather = e.target.value))} />
                </Row>
              </div>
              <Row label="体位や姿勢、続いている接触" changed={!!prevState && JSON.stringify(prevState.pose ?? null) !== JSON.stringify(local.pose ?? null)}>
                <div className="space-y-1">
                  <Input className={sm} value={local.pose?.position ?? ''} placeholder="例 sitting on the bench" onChange={(e) => edit((s) => void (s.pose = { position: e.target.value, contacts: s.pose?.contacts ?? [] }))} />
                  {(local.pose?.contacts ?? []).map((c, i) => (
                    <div key={i} className="flex items-center gap-1 text-xs">
                      <span className="shrink-0 text-dim">{c.who.map((w) => people.find((p) => p.id === w)?.name ?? plot.characters.find((x) => x.id === w)?.name ?? w).join('と')}</span>
                      <Input className={sm} value={c.what} onChange={(e) => edit((s) => void (s.pose!.contacts[i].what = e.target.value))} />
                      <button type="button" className="text-faint hover:text-danger" onClick={() => edit((s) => void s.pose!.contacts.splice(i, 1))}>
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              </Row>

              <div className="pt-2">
                <div className="mb-1 flex gap-1 overflow-x-auto">
                  {people.map((p) => {
                    const changed = !!prevState && diffOutfit(prevState.outfits[p.id], local.outfits[p.id]).length > 0;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPersonTab(p.id)}
                        className={cx('whitespace-nowrap rounded-md px-2.5 py-1 text-xs', person?.id === p.id ? 'bg-panel2 text-ink' : 'text-dim hover:text-ink')}
                      >
                        {p.name}
                        {changed && <span className="ml-1 text-gold">●</span>}
                      </button>
                    );
                  })}
                </div>
                {person && (
                  <div className="rounded-md border border-line bg-shade p-2">
                    {prevState && diffOutfit(prevState.outfits[person.id], local.outfits[person.id]).length > 0 && (
                      <div className="mb-2 flex justify-end">
                        <Button size="sm" variant="ghost" onClick={() => edit((s) => void (s.outfits[person.id] = structuredClone(prevState.outfits[person.id] ?? emptyOutfit())))}>
                          <Icon name="undo" size={12} /> 直前に戻す
                        </Button>
                      </div>
                    )}
                    <OutfitEditor
                      compact
                      value={local.outfits[person.id] ?? emptyOutfit()}
                      onChange={(o) => edit((s) => void (s.outfits[person.id] = o))}
                      highlight={prevState ? diffOutfit(prevState.outfits[person.id], local.outfits[person.id]) : []}
                      exposure={exposedParts(local.outfits[person.id], person.sex)}
                    />
                    <p className="mt-2 text-[11px] leading-relaxed text-faint">状況は返答と{T.illust}を作るときに更新されます。手で直したところは、物語の中で変わるまで毎回会話に伝えます。</p>
                  </div>
                )}
              </div>
            </div>
          ))}

        {tab === 'settings' && (
          <div className="space-y-4">
            <Field label="進め方">
              <Segmented value={chat.mode} onChange={(v) => onChat({ mode: v })} options={(['rp', 'novel'] as const).map((v) => ({ value: v, label: MODE_LABELS[v] }))} />
            </Field>
            <Field label={T.safety} hint="挿絵だけに使います">
              <Select value={normalizeSafety(chat.safety)} onChange={(e) => onChat({ safety: e.target.value as Safety })}>
                {(Object.keys(SAFETY_LABELS) as Safety[]).map((s) => (
                  <option key={s} value={s}>
                    {SAFETY_LABELS[s]}（{SAFETY_TAGS[s].join(', ')}）
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={T.userMode}>
              <Segmented value={chat.userMode} onChange={(v) => onChat({ userMode: v as UserMode })} options={(['include', 'pov', 'exclude'] as const).map((v) => ({ value: v, label: USER_MODE_LABELS[v] }))} />
            </Field>
            <Toggle checked={chat.autoIllustrate} onChange={(v) => onChat({ autoIllustrate: v })} label={`返答ごとに${T.illust}を作る`} />
            <Field label={`${T.illust}に入れる状況`} hint="外すと、その欄は会話にだけ使い、絵には描きません。屋内でも窓と外が描かれるときに外します">
              <div className="flex flex-wrap gap-4">
                <Toggle checked={chat.illustTime !== false} onChange={(v) => onChat({ illustTime: v })} label="時間帯" />
                <Toggle checked={chat.illustWeather !== false} onChange={(v) => onChat({ illustWeather: v })} label="天気" />
              </div>
            </Field>
            <Field label={T.preset}>
              <Select value={chat.presetId} onChange={(e) => onChat({ presetId: e.target.value })}>
                {(presets.data ?? ([] as Preset[])).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[13px] font-medium">{T.style}</span>
                {chat.styleOverride && (
                  <Button size="sm" variant="ghost" onClick={() => onChat({ styleOverride: undefined })}>
                    {T.plot}の既定に戻す
                  </Button>
                )}
              </div>
              <StyleFields value={style} onChange={(patch) => onChat({ styleOverride: { ...(chat.styleOverride ?? {}), ...patch } })} />
            </div>
          </div>
        )}

        {tab === 'summary' && <SummaryList summaries={summaries} onSummary={onSummary} />}
      </div>
    </div>
  );
}

function SummaryList({ summaries, onSummary }: { summaries: Summary[]; onSummary: (a: { kind: 'save'; id: string; text: string } | { kind: 'redo'; id: string } | { kind: 'delete'; id: string }) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  if (summaries.length === 0) {
    return <div className="text-xs leading-relaxed text-dim">履歴が長くなると、古い方から自動で{T.summary}にまとめます。まとめた{T.summary}はここで見て、手で直せます。</div>;
  }
  return (
    <div className="space-y-3">
      {summaries.map((s, i) => (
        <div key={s.id} className="rounded-md border border-line bg-shade p-2.5">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs text-faint">
              {T.summary} {i + 1} {s.stale && <Badge tone="danger">古い</Badge>}
            </span>
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => onSummary({ kind: 'redo', id: s.id })} title="要約し直す">
                <Icon name="refresh" size={12} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(s.id);
                  setDraft(s.text);
                }}
              >
                <Icon name="edit" size={12} />
              </Button>
              <ConfirmButton variant="ghost" onConfirm={() => onSummary({ kind: 'delete', id: s.id })} confirmLabel="消す？">
                <Icon name="trash" size={12} />
              </ConfirmButton>
            </div>
          </div>
          {editing === s.id ? (
            <div className="space-y-2">
              <TextArea autoGrow rows={5} value={draft} onChange={(e) => setDraft(e.target.value)} className="text-xs" />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    onSummary({ kind: 'save', id: s.id, text: draft });
                    setEditing(null);
                  }}
                >
                  保存
                </Button>
                <Button size="sm" onClick={() => setEditing(null)}>
                  やめる
                </Button>
              </div>
            </div>
          ) : (
            <div className="whitespace-pre-wrap text-xs leading-relaxed text-dim">{s.text}</div>
          )}
        </div>
      ))}
    </div>
  );
}
