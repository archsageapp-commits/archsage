import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  COVER_TARGET,
  NEW_PERSON,
  PLAYER_TARGET,
  illustMissing,
  wizardStale,
  type IntroCandidate,
  type OutfitState,
  type Plot,
  type PlotWizard,
  type Sex,
  type StoryCandidate,
  type WizardCandidates,
  type WizardCandidateStep,
  type WizardStepKey,
  type WizardTry,
} from '@archsage/shared';
import { api, imageUrl } from '../api.ts';
import { IllustFields } from '../components/Fields.tsx';
import { Lightbox } from '../components/Lightbox.tsx';
import { OutfitEditor } from '../components/OutfitEditor.tsx';
import { RATING_LABELS, T } from '../terms.ts';
import { Badge, Button, Card, ConfirmButton, cx, ErrorText, Field, Icon, Input, Segmented, Spinner, TagsInput, TextArea, Toggle } from '../ui.tsx';

type View = 'concept' | WizardStepKey | 'finish';

const VIEWS: { key: View; label: string }[] = [
  { key: 'concept', label: 'コンセプト' },
  { key: 'story', label: T.story },
  { key: 'cast', label: T.character },
  { key: 'player', label: T.player },
  { key: 'intro', label: T.intro },
  { key: 'finish', label: '仕上げ' },
];

const STEP_HINTS: Record<WizardCandidateStep, string> = {
  story: `題名、${T.story}、${T.playerPosition}の候補です。`,
  intro: `物語の出だしの場面の候補です。`,
};

// 前の段があとから変わったときの知らせ。後の段は消さずに残す
const STALE_HINTS: Partial<Record<WizardStepKey | 'finish', string>> = {
  cast: `${T.story}が変わりました。${T.character}を見直すとよいかもしれません。`,
  player: `${T.story}が変わりました。${T.player}を見直すとよいかもしれません。`,
  intro: `${T.story}、${T.character}、${T.player}のどれかが変わりました。${T.intro}を見直すとよいかもしれません。`,
  finish: `前の段が変わりました。${T.listing}を作り直すとよいかもしれません。`,
};

function nextView(v: View): View {
  return VIEWS[Math.min(VIEWS.findIndex((x) => x.key === v) + 1, VIEWS.length - 1)].key;
}

function hasPlayer(p: Plot): boolean {
  const pl = p.players[0];
  return !!pl && !!(pl.description.trim() || pl.appearanceText?.trim());
}

// 段が済んだかは、シナリオに中身があるかで決める
function done(p: Plot, w: PlotWizard, v: View): boolean {
  if (v === 'concept') return !!w.concept.trim();
  if (v === 'story') return !!p.story.trim();
  if (v === 'cast') return p.characters.length > 0;
  if (v === 'player') return hasPlayer(p);
  if (v === 'intro') return !!p.intros[0]?.text.trim();
  return !!w.finished;
}

// まだ中身のない最初の段から始める
function firstView(p: Plot, w: PlotWizard): View {
  if (!w.concept.trim() && !p.story.trim()) return 'concept';
  return VIEWS.find((v) => v.key !== 'concept' && !done(p, w, v.key))?.key ?? 'finish';
}

// 待っている時間を見せる。候補は3つまとめて作るので、数十秒かかることがある
function Waiting({ label }: { label: string }) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 py-10 text-sm text-dim">
      <Spinner className="h-4 w-4" /> {label}… {sec}秒
    </div>
  );
}

// 1人分の、画面で直せる欄
interface PersonPatch {
  name?: string;
  profile?: string;
  illust?: Partial<{ sex: Sex; countTag: string; appearanceText: string }>;
  outfit?: OutfitState;
}

export function WizardPage() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const plot = useQuery({ queryKey: ['plot', id], queryFn: () => api.plot(id) });
  const wizard = useQuery({ queryKey: ['wizard', id], queryFn: () => api.wizard(id) });
  const [view, setView] = useState<View | null>(null);
  const [concept, setConcept] = useState('');
  const [lightbox, setLightbox] = useState<{ files: string[]; index: number } | null>(null);
  const [trying, setTrying] = useState<{ target: string; kind: 'full' | 'bust' } | null>(null);
  // キャラの段で開いている人
  const [sel, setSel] = useState('');

  // 名前や服装を画面で直したときは、少し待ってまとめて保存する。AIを呼ぶ前には必ず保存する
  const [draft, setDraft] = useState<Plot | null>(null);
  const draftRef = useRef<Plot | null>(null);
  draftRef.current = draft;
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (plot.data && !dirty.current) setDraft(plot.data);
  }, [plot.data]);
  const save = useCallback(async () => {
    const d = draftRef.current;
    if (!dirty.current || !d) return;
    dirty.current = false;
    qc.setQueryData(['plot', id], await api.savePlot(d));
  }, [id, qc]);
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
  const edit = (fn: (p: Plot) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), 800);
  };
  const editPerson = (target: string, patch: PersonPatch) =>
    edit((d) => {
      if (target === PLAYER_TARGET) {
        const p = d.players[0];
        if (!p) return;
        if (patch.name !== undefined) p.name = patch.name;
        if (patch.profile !== undefined) p.description = patch.profile;
        if (patch.illust) Object.assign(p, patch.illust);
        if (patch.outfit) p.defaultOutfit = patch.outfit;
        return;
      }
      const c = d.characters.find((x) => x.id === target);
      if (!c) return;
      if (patch.name !== undefined) c.name = patch.name;
      if (patch.profile !== undefined) c.profile = patch.profile;
      if (patch.illust) Object.assign(c.illust, patch.illust);
      if (patch.outfit) c.illust.defaultOutfit = patch.outfit;
    });

  const setWizard = (w: PlotWizard) => qc.setQueryData(['wizard', id], w);
  const setPlot = (p: Plot) => {
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    setDraft(p);
    qc.setQueryData(['plot', id], p);
    qc.invalidateQueries({ queryKey: ['plots'] });
  };

  useEffect(() => {
    if (wizard.data && plot.data && view === null) {
      const asked = params.get('view') as View | null;
      setView(asked && VIEWS.some((v) => v.key === asked) ? asked : firstView(plot.data, wizard.data));
      setConcept(wizard.data.concept);
    }
  }, [wizard.data, plot.data, view, params]);

  const generate = useMutation({
    mutationFn: async (a: { step: WizardCandidateStep; request?: string; present?: string[] }) => {
      if (a.step === 'story' && concept !== wizard.data?.concept) setWizard(await api.saveWizard(id, { concept }));
      await flush();
      return api.wizardGenerate(id, a.step, a.request, a.present);
    },
    onSuccess: (w) => {
      setWizard(w);
      // 「あなた」を主人公に入れ直しているので、シナリオも読み直す
      qc.invalidateQueries({ queryKey: ['plot', id] });
    },
  });
  const person = useMutation({
    mutationFn: async (a: { target: string; request?: string }) => {
      await flush();
      return api.wizardPerson(id, a.target, a.request);
    },
    onSuccess: (r, a) => {
      setWizard(r.wizard);
      setPlot(r.plot);
      // 足した人を開く
      if (a.target === NEW_PERSON) setSel(r.id);
    },
  });
  const undo = useMutation({
    mutationFn: async (target: string) => {
      await flush();
      return api.wizardUndo(id, target);
    },
    onSuccess: (r) => {
      setWizard(r.wizard);
      setPlot(r.plot);
    },
  });
  const remove = useMutation({
    mutationFn: async (charId: string) => {
      await flush();
      return api.wizardRemove(id, charId);
    },
    onSuccess: (r) => {
      setWizard(r.wizard);
      setPlot(r.plot);
    },
  });
  // 立ち絵（全身）とアイコン（バストアップ）は別々に描く
  const tryLook = useMutation({
    mutationFn: async (a: { target: string; kind: 'full' | 'bust' }) => {
      await flush();
      setTrying(a);
      return api.wizardTry(id, a.target, a.kind);
    },
    onSuccess: (r) => {
      setWizard(r.wizard);
      setPlot(r.plot);
    },
    onSettled: () => setTrying(null),
  });
  const cover = useMutation({
    mutationFn: async (a: { request: string; present: string[]; player: boolean }) => {
      await flush();
      return api.wizardCover(id, a.request, a.present, a.player);
    },
    onSuccess: (r) => {
      setWizard(r.wizard);
      setPlot(r.plot);
    },
  });
  const useCover = useMutation({
    mutationFn: async (file: string) => {
      await flush();
      return api.wizardUseCover(id, file);
    },
    onSuccess: (p) => setPlot(p),
  });
  const icon = useMutation({
    mutationFn: async (a: { charId: string; file: string }) => {
      await flush();
      return api.wizardIcon(id, a.charId, a.file);
    },
    onSuccess: (p) => setPlot(p),
  });
  const choose = useMutation({
    mutationFn: async (a: { step: WizardCandidateStep; index: number; candidate: WizardCandidates[WizardCandidateStep]; mode?: 'replace' | 'add' }) => {
      await flush();
      return api.wizardChoose(id, a.step, a.index, a.candidate, a.mode);
    },
    onSuccess: (r, a) => {
      setWizard(r.wizard);
      setPlot(r.plot);
      const next = nextView(a.step);
      setView(next);
      // 筋書きを選んだら、まだキャラがいなければ1人目を作り始める
      if (next === 'cast' && r.plot.characters.length === 0) person.mutate({ target: NEW_PERSON });
    },
  });
  const finish = useMutation({
    mutationFn: async () => {
      await flush();
      return api.wizardFinish(id);
    },
    onSuccess: (r) => {
      setWizard(r.wizard);
      setPlot(r.plot);
    },
  });
  const reset = useMutation({
    mutationFn: () => api.resetWizard(id),
    onSuccess: (w) => {
      setWizard(w);
      setConcept('');
      setView('concept');
    },
  });
  const saveConcept = useMutation({
    mutationFn: (patch: { concept?: string }) => api.saveWizard(id, patch),
    onSuccess: (w) => {
      setWizard(w);
      qc.invalidateQueries({ queryKey: ['plot', id] });
    },
  });

  const w = wizard.data;
  const p = draft;
  if (!w || !p || view === null) return <div className="p-6">{wizard.error || plot.error ? <ErrorText error={wizard.error ?? plot.error} /> : <Spinner />}</div>;

  const views = VIEWS;
  const stale = wizardStale(w);
  // 文章を作るAIは一度に1つだけ呼ぶ
  const aiBusy = generate.isPending || person.isPending || undo.isPending || choose.isPending || finish.isPending;
  const busyView: View | undefined = generate.isPending ? generate.variables?.step : person.isPending ? (person.variables?.target === PLAYER_TARGET ? 'player' : 'cast') : finish.isPending ? 'finish' : undefined;
  const go = (v: View) => {
    setView(v);
    // 次の段に中身がなければ、すぐに作り始める
    if (v === 'player' && !hasPlayer(p) && !aiBusy) person.mutate({ target: PLAYER_TARGET });
    if (v === 'intro' && !w.steps.intro && p.characters.length && !aiBusy) generate.mutate({ step: 'intro', present: w.present?.length ? w.present : p.characters.map((c) => c.id) });
  };
  const personProps = (target: string) => ({
    tries: w.tries?.[target] ?? [],
    canUndo: !!w.previous?.[target],
    remaking: person.isPending && person.variables?.target === target,
    trying: trying?.target === target ? trying.kind : null,
    aiBusy,
    imageBusy: tryLook.isPending,
    imageError: tryLook.variables?.target === target ? tryLook.error : null,
    onEdit: (patch: PersonPatch) => editPerson(target, patch),
    onRemake: (request: string) => person.mutate({ target, request }),
    onUndo: () => undo.mutate(target),
    onTry: (kind: 'full' | 'bust') => tryLook.mutate({ target, kind }),
    onOpen: (files: string[], index: number) => setLightbox({ files, index }),
  });
  const selected = p.characters.find((c) => c.id === sel) ?? p.characters[0];
  const creating = person.isPending && person.variables?.target === NEW_PERSON;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-line px-5 py-2.5">
        <Link to={`/plots/${id}`} className="text-dim hover:text-ink" title="戻る" onClick={() => void flush()}>
          <Icon name="left" />
        </Link>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Badge tone="gold">{T.wizard}</Badge>
          <span className="truncate font-semibold">{p.title || '（無題）'}</span>
        </div>
        <ConfirmButton variant="ghost" onConfirm={() => reset.mutate()} confirmLabel="候補をすべて消す？">
          最初から
        </ConfirmButton>
        <Link to={`/plots/${id}/edit`} onClick={() => void flush()}>
          <Button size="sm">
            <Icon name="edit" size={13} /> 編集画面へ
          </Button>
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-1.5 border-b border-line px-4 py-2.5">
        {views.map((v, i) => (
          <div key={v.key} className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => go(v.key)}
              className={cx(
                'flex h-7 items-center gap-1 rounded-full px-3 text-xs transition-colors',
                v.key === view ? 'bg-gold text-on-gold' : done(p, w, v.key) ? 'bg-gold/15 text-gold hover:bg-gold/25' : 'bg-panel2 text-faint hover:text-dim',
              )}
            >
              {done(p, w, v.key) && v.key !== view && <Icon name="check" size={11} />}
              {i + 1}. {v.label}
              {busyView === v.key && <Spinner className="ml-1 h-3 w-3" />}
            </button>
            {i < views.length - 1 && <div className="h-px w-4 bg-line" />}
          </div>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <ErrorText error={generate.error ?? person.error ?? undo.error ?? remove.error ?? icon.error ?? useCover.error ?? choose.error ?? finish.error ?? reset.error ?? saveConcept.error} />
          {view !== 'concept' && STALE_HINTS[view] && stale.includes(view) && <p className="mb-4 text-sm text-gold">{STALE_HINTS[view]}</p>}
          {view === 'concept' && (
            <div className="mx-auto max-w-2xl space-y-4">
              <p className="text-sm text-dim">
                作りたい話を自由に書いてください。ジャンル、雰囲気、{T.character}の人数、入れたい場面など、思いつくものだけでかまいません。このあと、{views.slice(1, -1).map((v) => v.label).join('、')}を決めていきます。どれも、あとから1つずつ作り直せます。
              </p>
              <TextArea
                rows={7}
                autoGrow
                value={concept}
                placeholder="例 魔法が少しだけ残る町の学園もの。部員2人の魔法研究会に入部する。ほのぼのした日常と、満月の夜の小さな謎"
                onChange={(e) => setConcept(e.target.value)}
                onBlur={() => concept !== w.concept && saveConcept.mutate({ concept })}
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  disabled={!concept.trim() || aiBusy}
                  onClick={() => {
                    setView('story');
                    generate.mutate({ step: 'story' });
                  }}
                >
                  <Icon name="sparkle" size={14} /> {T.story}の候補を出す
                </Button>
              </div>
            </div>
          )}
          {view === 'story' && (
            <StepView
              key="story"
              step="story"
              wizard={w}
              busy={generate.isPending && generate.variables?.step === 'story'}
              disabled={aiBusy}
              onGenerate={(request) => generate.mutate({ step: 'story', request })}
              actions={(i, c) => (
                <Button variant="primary" onClick={() => choose.mutate({ step: 'story', index: i, candidate: c })} disabled={aiBusy}>
                  <Icon name="check" size={14} /> これにする
                </Button>
              )}
            />
          )}
          {view === 'cast' && (
            <div className="space-y-4">
              <p className="text-sm text-dim">
                {T.character}を1人ずつ作ります。名前とプロフィールに加えて、見た目の英文と初めの服装も作ります。立ち絵（全身）とアイコン（バストアップ）を描いて確かめられ、どの欄も手で直せます。
              </p>
              <div className="grid gap-5 md:grid-cols-[200px_1fr]">
                <div className="space-y-1">
                  {p.characters.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setSel(c.id)}
                      className={cx('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', c.id === selected?.id ? 'bg-panel2 text-gold' : 'text-dim hover:bg-panel hover:text-ink')}
                    >
                      {c.avatar ? <img src={imageUrl(c.avatar)} alt="" className="h-7 w-7 rounded-full object-cover" /> : <span className="flex h-7 w-7 items-center justify-center rounded-full bg-panel2 text-[11px]">{c.name.slice(0, 1)}</span>}
                      <span className="min-w-0 flex-1 truncate">{c.name || '（名前なし）'}</span>
                      {((person.isPending && person.variables?.target === c.id) || trying?.target === c.id) && <Spinner className="h-3 w-3" />}
                    </button>
                  ))}
                  {creating && (
                    <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-dim">
                      <Spinner className="h-3.5 w-3.5" /> 作っています…
                    </div>
                  )}
                  <AddPerson disabled={aiBusy} onSubmit={(request) => person.mutate({ target: NEW_PERSON, request })} />
                </div>
                <div className="min-w-0">
                  {selected ? (
                    <PersonCard
                      key={selected.id}
                      isChar
                      name={selected.name}
                      profile={selected.profile}
                      illust={selected.illust}
                      outfit={selected.illust.defaultOutfit}
                      avatar={selected.avatar}
                      fullBody={selected.fullBody}
                      {...personProps(selected.id)}
                      onIcon={(file) => icon.mutate({ charId: selected.id, file })}
                      onRemove={() => remove.mutate(selected.id)}
                    />
                  ) : creating ? (
                    <Card className="px-4">
                      <Waiting label={`${T.character}を作っています`} />
                    </Card>
                  ) : (
                    <p className="py-10 text-center text-sm text-faint">左の「{T.character}を足す」で作ります</p>
                  )}
                </div>
              </div>
              <NextButton disabled={!p.characters.length} onClick={() => go(nextView('cast'))} />
            </div>
          )}
          {view === 'player' && (
            <div className="space-y-4">
              <p className="text-sm text-dim">あなたが演じる{T.player}を作ります。見た目の英文と初めの服装も作り、「見た目を試す」で全身の絵を描いて確かめられます。</p>
              {hasPlayer(p) && p.players[0] ? (
                <PersonCard
                  name={p.players[0].name}
                  profile={p.players[0].description}
                  illust={{ sex: p.players[0].sex, countTag: p.players[0].countTag, appearanceText: p.players[0].appearanceText }}
                  outfit={p.players[0].defaultOutfit ?? { slots: {} }}
                  fullBody={p.players[0].fullBody}
                  {...personProps(PLAYER_TARGET)}
                />
              ) : person.isPending && person.variables?.target === PLAYER_TARGET ? (
                <Waiting label={`${T.player}を作っています`} />
              ) : (
                <RequestRow placeholder="注文（例 転校してきたばかりの2年生）" label={`${T.player}を作る`} icon="sparkle" disabled={aiBusy} onSubmit={(request) => person.mutate({ target: PLAYER_TARGET, request })} />
              )}
              <NextButton disabled={!hasPlayer(p)} onClick={() => go('intro')} />
            </div>
          )}
          {view === 'intro' && (
            <IntroView
              key={p.characters.map((c) => c.id).join()}
              plot={p}
              wizard={w}
              busy={generate.isPending && generate.variables?.step === 'intro'}
              disabled={aiBusy}
              onGenerate={(request, present) => generate.mutate({ step: 'intro', request, present })}
              onChoose={(index, candidate, mode) => choose.mutate({ step: 'intro', index, candidate, mode })}
            />
          )}
          {view === 'finish' && (
            <FinishView
              plot={p}
              wizard={w}
              busy={finish.isPending}
              disabled={aiBusy}
              onFinish={() => finish.mutate()}
              edit={edit}
              coverBusy={cover.isPending}
              coverError={cover.error}
              onCover={(request, present, player) => cover.mutate({ request, present, player })}
              onUseCover={(file) => useCover.mutate(file)}
              onOpen={(files, index) => setLightbox({ files, index })}
            />
          )}
        </div>
      </div>
      {lightbox && <Lightbox items={lightbox.files.map((file) => ({ file }))} index={lightbox.index} onClose={() => setLightbox(null)} />}
    </div>
  );
}

// キャラと主人公の段は長いので、スクロールしなくても押せるよう画面の下に貼り付ける
function NextButton({ disabled, onClick }: { disabled: boolean; onClick: () => void }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-6 flex justify-end border-t border-line bg-bg/95 px-6 py-3 backdrop-blur">
      <Button variant="primary" disabled={disabled} onClick={onClick}>
        次へ <Icon name="right" size={14} />
      </Button>
    </div>
  );
}

function RequestRow({ placeholder, label, icon, disabled, onSubmit }: { placeholder: string; label: string; icon: string; disabled: boolean; onSubmit: (request: string) => void }) {
  const [request, setRequest] = useState('');
  const submit = () => {
    if (disabled) return;
    onSubmit(request.trim());
    setRequest('');
  };
  return (
    <div className="flex gap-2">
      <Input
        value={request}
        placeholder={placeholder}
        onChange={(e) => setRequest(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) submit();
        }}
      />
      <Button onClick={submit} disabled={disabled}>
        <Icon name={icon} size={14} /> {label}
      </Button>
    </div>
  );
}

// 一覧の下に置く、キャラを1人足す欄
function AddPerson({ disabled, onSubmit }: { disabled: boolean; onSubmit: (request: string) => void }) {
  const [request, setRequest] = useState('');
  return (
    <div className="mt-2 space-y-1.5 border-t border-line pt-3">
      <div className="text-xs font-medium text-dim">新しく足す{T.character}の注文</div>
      <TextArea rows={2} className="text-[13px]" value={request} placeholder="例 主人公の幼なじみ" onChange={(e) => setRequest(e.target.value)} />
      <div className="text-xs text-faint">空なら{T.story}に合わせて考えます</div>
      <Button
        size="sm"
        className="w-full"
        disabled={disabled}
        onClick={() => {
          onSubmit(request.trim());
          setRequest('');
        }}
      >
        <Icon name="plus" size={13} /> {T.character}を足す
      </Button>
    </div>
  );
}

function PersonCard({
  isChar,
  name,
  profile,
  illust,
  outfit,
  avatar,
  fullBody,
  tries,
  canUndo,
  remaking,
  trying,
  aiBusy,
  imageBusy,
  imageError,
  onEdit,
  onRemake,
  onUndo,
  onTry,
  onOpen,
  onIcon,
  onRemove,
}: {
  isChar?: boolean;
  name: string;
  profile: string;
  illust: { sex: Sex; countTag: string; appearanceText?: string };
  outfit: OutfitState;
  avatar?: string;
  fullBody?: string;
  tries: WizardTry[];
  canUndo: boolean;
  remaking: boolean;
  trying: 'full' | 'bust' | null;
  aiBusy: boolean;
  imageBusy: boolean;
  imageError: unknown;
  onEdit: (patch: PersonPatch) => void;
  onRemake: (request: string) => void;
  onUndo: () => void;
  onTry: (kind: 'full' | 'bust') => void;
  onOpen: (files: string[], index: number) => void;
  onIcon?: (file: string) => void;
  onRemove?: () => void;
}) {
  const [request, setRequest] = useState('');
  // 新しい絵から並べる
  const shown = [...tries].reverse();
  const remake = () => {
    onRemake(request.trim());
    setRequest('');
  };
  return (
    <Card className="relative space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="min-w-48 flex-1"
          value={request}
          placeholder="注文を添えて作り直す（例 もっと年上に、髪を黒く）"
          onChange={(e) => setRequest(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing && !aiBusy) remake();
          }}
        />
        <Button onClick={remake} disabled={aiBusy}>
          <Icon name="refresh" size={14} /> AIと作り直す
        </Button>
        {canUndo && (
          <Button variant="ghost" onClick={onUndo} disabled={aiBusy} title="AIと作り直す前の中身に戻す">
            <Icon name="undo" size={14} /> 元に戻す
          </Button>
        )}
        {onRemove && (
          <ConfirmButton variant="ghost" onConfirm={onRemove} confirmLabel="外す？">
            <Icon name="trash" size={13} /> 外す
          </ConfirmButton>
        )}
      </div>
      <ErrorText error={imageError} />
      {shown.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {shown.map((t, i) => (
            <div key={t.id} className="shrink-0 space-y-1">
              <button type="button" onClick={() => onOpen(shown.map((x) => x.file), i)} className="block">
                <img src={imageUrl(t.file)} alt="" className={cx('h-28 rounded-md border object-cover', t.kind === 'bust' ? 'aspect-square' : 'aspect-[2/3]', t.file === avatar || t.file === fullBody ? 'border-gold' : 'border-line')} />
              </button>
              {isChar && t.kind === 'bust' && onIcon && (t.file === avatar ? <Badge tone="gold">アイコン</Badge> : <Button size="sm" variant="ghost" onClick={() => onIcon(t.file)}>アイコンにする</Button>)}
              {t.kind === 'full' && t.file === fullBody && <Badge tone="gold">立ち絵</Badge>}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-4">
        <div className="w-28 shrink-0 space-y-2">
          {isChar && (
            <>
              <div className="aspect-square w-28 overflow-hidden rounded-lg border border-line bg-panel2">
                {avatar ? <img src={imageUrl(avatar)} alt="" className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-2xl text-faint">{name.slice(0, 1) || '?'}</div>}
              </div>
              <Button size="sm" className="w-28" onClick={() => onTry('bust')} disabled={imageBusy} title="バストアップの絵を描いて、アイコンにする">
                {trying === 'bust' ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="user" size={13} />} アイコンを描く
              </Button>
            </>
          )}
          {fullBody ? (
            <button type="button" onClick={() => onOpen([fullBody], 0)} className="block w-28" title="立ち絵（最後に描いた全身）">
              <img src={imageUrl(fullBody)} alt="" className="aspect-[2/3] w-28 rounded-lg border border-line object-cover" />
            </button>
          ) : (
            <div className="flex aspect-[2/3] w-28 items-center justify-center rounded-lg border border-dashed border-line px-2 text-center text-[11px] text-faint">立ち絵はまだありません</div>
          )}
          <Button size="sm" className="w-28" onClick={() => onTry('full')} disabled={imageBusy} title="全身の絵を描いて、服装を確かめる">
            {trying === 'full' ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="image" size={13} />} 立ち絵を描く
          </Button>
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <Field label="名前">
            <Input value={name} onChange={(e) => onEdit({ name: e.target.value })} />
          </Field>
          <Field label={isChar ? 'プロフィール' : '説明'}>
            <TextArea autoGrow rows={4} className="text-[13px]" value={profile} onChange={(e) => onEdit({ profile: e.target.value })} />
          </Field>
          <IllustFields value={illust} onChange={(patch) => onEdit({ illust: patch })} />
          <Field label="初めの服装">
            <OutfitEditor compact value={outfit} onChange={(o) => onEdit({ outfit: o })} />
          </Field>
        </div>
      </div>
      {remaking && (
        <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-bg/70">
          <Waiting label="作り直しています" />
        </div>
      )}
    </Card>
  );
}

function StepView<K extends WizardCandidateStep>({
  step,
  wizard,
  busy,
  disabled,
  onGenerate,
  actions,
  generateLabel = '候補を出す',
}: {
  step: K;
  wizard: PlotWizard;
  busy: boolean;
  disabled: boolean;
  onGenerate: (request: string) => void;
  actions: (index: number, candidate: WizardCandidates[K]) => ReactNode;
  generateLabel?: string;
}) {
  const s = wizard.steps[step];
  const candidates = (s?.candidates ?? []) as WizardCandidates[K][];
  // 選ぶ前に手で直せるよう、候補を手元に写しておく
  const [drafts, setDrafts] = useState(candidates);
  const [request, setRequest] = useState('');
  useEffect(() => setDrafts(candidates), [s?.candidates]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (i: number, fn: (c: WizardCandidates[K]) => void) =>
    setDrafts((prev) =>
      prev.map((c, j) => {
        if (j !== i) return c;
        const n = structuredClone(c);
        fn(n);
        return n;
      }),
    );

  return (
    <div className="space-y-4">
      <p className="text-sm text-dim">
        {STEP_HINTS[step]}
        {candidates.length > 0 && '選ぶ前に、候補の文章を直せます。'}
      </p>
      {busy ? (
        <Waiting label="候補を作っています" />
      ) : candidates.length === 0 ? (
        <div className="py-10 text-center">
          <Button variant="primary" onClick={() => onGenerate('')} disabled={disabled}>
            <Icon name="sparkle" size={14} /> {generateLabel}
          </Button>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-3">
          {drafts.map((c, i) => (
            <Card key={i} className={cx('flex flex-col gap-3 p-4', s?.chosen === i && 'border-gold/50')}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1 text-sm font-semibold text-gold-soft">{c.pitch || `案${i + 1}`}</div>
                {s?.chosen === i && <Badge tone="gold">選んだもの</Badge>}
              </div>
              <div className="flex-1 space-y-3">
                {step === 'story' && <StoryFields c={c as StoryCandidate} edit={(fn) => edit(i, fn as (c: WizardCandidates[K]) => void)} />}
                {step === 'intro' && <IntroFields c={c as IntroCandidate} edit={(fn) => edit(i, fn as (c: WizardCandidates[K]) => void)} />}
              </div>
              <div className="flex flex-wrap gap-2">{actions(i, c)}</div>
            </Card>
          ))}
        </div>
      )}
      {candidates.length > 0 && !busy && (
        <div className="flex gap-2">
          <Input
            value={request}
            placeholder="注文を添えて出し直す（例 もっと暗い話に、夜の場面に）"
            onChange={(e) => setRequest(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing && !disabled) onGenerate(request.trim());
            }}
          />
          <Button onClick={() => onGenerate(request.trim())} disabled={disabled}>
            <Icon name="refresh" size={14} /> 出し直す
          </Button>
        </div>
      )}
    </div>
  );
}

// 導入は、場面に出すキャラを先に選んでから候補を出す。初めは全員
function IntroView({
  plot,
  wizard,
  busy,
  disabled,
  onGenerate,
  onChoose,
}: {
  plot: Plot;
  wizard: PlotWizard;
  busy: boolean;
  disabled: boolean;
  onGenerate: (request: string, present: string[]) => void;
  onChoose: (index: number, candidate: IntroCandidate, mode: 'replace' | 'add') => void;
}) {
  const ids = plot.characters.map((c) => c.id);
  const [present, setPresent] = useState<string[]>(() => {
    const saved = (wizard.present ?? []).filter((x) => ids.includes(x));
    return saved.length ? saved : ids;
  });
  const hasIntro = !!plot.intros[0]?.text.trim();
  const toggle = (cid: string) => setPresent((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : ids.filter((x) => prev.includes(x) || x === cid)));
  if (!plot.characters.length) return <p className="text-sm text-dim">先に{T.character}を作ってください。</p>;
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="text-sm text-dim">場面にいる{T.character}</div>
        <div className="flex flex-wrap gap-2">
          {plot.characters.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => toggle(c.id)}
              className={cx('flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors', present.includes(c.id) ? 'border-gold/60 bg-gold/15 text-gold' : 'border-line text-faint hover:text-dim')}
            >
              {present.includes(c.id) && <Icon name="check" size={12} />}
              {c.name || '（名前なし）'}
            </button>
          ))}
        </div>
        {!present.length && <p className="text-xs text-danger">1人以上選んでください</p>}
      </div>
      <StepView
        step="intro"
        wizard={wizard}
        busy={busy}
        disabled={disabled || !present.length}
        onGenerate={(request) => onGenerate(request, present)}
        actions={(i, c) => (
          <>
            <Button variant="primary" onClick={() => onChoose(i, c, 'replace')} disabled={disabled}>
              <Icon name="check" size={14} /> {hasIntro ? `${T.intro}1を置き換える` : 'これにする'}
            </Button>
            {hasIntro && (
              <Button onClick={() => onChoose(i, c, 'add')} disabled={disabled}>
                <Icon name="plus" size={14} /> {T.intro}として足す
              </Button>
            )}
          </>
        )}
      />
    </div>
  );
}

function Small({ label, children }: { label: string; children: ReactNode }) {
  return <Field label={<span className="text-xs text-dim">{label}</span>}>{children}</Field>;
}

function StoryFields({ c, edit }: { c: StoryCandidate; edit: (fn: (c: StoryCandidate) => void) => void }) {
  return (
    <>
      <Small label="題名">
        <Input value={c.title} onChange={(e) => edit((n) => void (n.title = e.target.value))} />
      </Small>
      <Small label={T.story}>
        <TextArea autoGrow className="text-[13px]" value={c.story} onChange={(e) => edit((n) => void (n.story = e.target.value))} />
      </Small>
      <Small label={T.playerPosition}>
        <TextArea autoGrow rows={2} className="text-[13px]" value={c.playerPosition} onChange={(e) => edit((n) => void (n.playerPosition = e.target.value))} />
      </Small>
    </>
  );
}

function IntroFields({ c, edit }: { c: IntroCandidate; edit: (fn: (c: IntroCandidate) => void) => void }) {
  return (
    <>
      <TextArea autoGrow className="text-[13px]" value={c.text} onChange={(e) => edit((n) => void (n.text = e.target.value))} />
      <div className="text-xs text-faint">{[c.present.join('、'), c.location, [c.time, c.weather].filter(Boolean).join('・')].filter(Boolean).join(' ／ ')}</div>
    </>
  );
}

// 仕上げ。紹介とセリフ例を作って直し、サムネイルを描く。編集画面を開かなくても、ここで一通りそろう
function FinishView({
  plot,
  wizard,
  busy,
  disabled,
  onFinish,
  edit,
  coverBusy,
  coverError,
  onCover,
  onUseCover,
  onOpen,
}: {
  plot: Plot;
  wizard: PlotWizard;
  busy: boolean;
  disabled: boolean;
  onFinish: () => void;
  edit: (fn: (p: Plot) => void) => void;
  coverBusy: boolean;
  coverError: unknown;
  onCover: (request: string, present: string[], player: boolean) => void;
  onUseCover: (file: string) => void;
  onOpen: (files: string[], index: number) => void;
}) {
  const [request, setRequest] = useState(wizard.coverRequest ?? '');
  // 描く人。選んでいなければ導入1の場面にいる人で、主人公はシナリオの描き方に従う
  const ids = plot.characters.map((c) => c.id);
  const [present, setPresent] = useState<string[]>(() => {
    const saved = (wizard.coverPresent ?? plot.intros[0]?.present ?? ids).filter((x) => ids.includes(x));
    return saved.length || wizard.coverPresent ? saved : ids;
  });
  const player = plot.players[0];
  const [withPlayer, setWithPlayer] = useState(wizard.coverPlayer ?? plot.style.defaultUserMode === 'include');
  const toggle = (cid: string) => setPresent((prev) => (prev.includes(cid) ? prev.filter((x) => x !== cid) : ids.filter((x) => prev.includes(x) || x === cid)));
  const nobody = !present.length && !(withPlayer && player);
  const missing = illustMissing(plot).map((x) => (x === PLAYER_TARGET ? (plot.players[0]?.name ?? T.player) : (plot.characters.find((c) => c.id === x)?.name ?? '')));
  const l = plot.listing;
  const made = !!(l.tagline || l.intro);
  const covers = [...(wizard.tries?.[COVER_TARGET] ?? [])].reverse();
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-semibold">
              {T.listing}と{T.examples}
            </h2>
            <p className="mt-0.5 text-xs text-faint">
              決めた内容から、一言紹介、紹介文、ハッシュタグ、{T.examples}を作ります。作り直すと、今の中身は置き換わります。
              {missing.length > 0 && `見た目の設定がまだない人（${missing.join('、')}）の分も、ここで作ります。`}
            </p>
          </div>
          {!busy && (
            <Button variant="primary" onClick={onFinish} disabled={!plot.characters.length || disabled}>
              <Icon name="sparkle" size={14} /> {made ? '作り直す' : '作る'}
            </Button>
          )}
        </div>
        {busy ? (
          <Waiting label="作っています" />
        ) : (
          <Card className="grid gap-4 p-4 md:grid-cols-2">
            <Field label="一言紹介">
              <Input value={l.tagline} onChange={(e) => edit((d) => void (d.listing.tagline = e.target.value))} />
            </Field>
            <Field label="ハッシュタグ">
              <TagsInput value={l.hashtags} onChange={(v) => edit((d) => void (d.listing.hashtags = v))} placeholder="例 学園, ファンタジー" />
            </Field>
            <Field label="紹介文" className="md:col-span-2">
              <TextArea autoGrow rows={4} className="text-[13px]" value={l.intro} onChange={(e) => edit((d) => void (d.listing.intro = e.target.value))} />
            </Field>
            <Field label={T.examples} className="md:col-span-2" hint="「名前「セリフ」」の形で1行ずつ">
              <TextArea autoGrow rows={4} className="text-[13px]" value={plot.examples} onChange={(e) => edit((d) => void (d.examples = e.target.value))} />
            </Field>
            <Field label={T.rating} className="md:col-span-2" hint={`投稿サイトと同じ区分です。札が出るだけで、会話と${T.illust}には影響しません`}>
              <Segmented value={l.rating} onChange={(v) => edit((d) => void (d.listing.rating = v))} options={(['all', 'r18', 'r18g'] as const).map((v) => ({ value: v, label: RATING_LABELS[v] }))} />
            </Field>
          </Card>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-[15px] font-semibold">{T.cover}</h2>
          <p className="mt-0.5 text-xs text-faint">
            一覧に出る縦長の絵です。描く人を選び、どんな絵にしたいかを自由に書けます。空なら{T.intro}1の場面から考えます。
          </p>
        </div>
        <div className="flex flex-wrap gap-5">
          <div className="w-48 shrink-0">
            {l.cover ? (
              <button type="button" onClick={() => onOpen([l.cover!], 0)} className="block w-48">
                <img src={imageUrl(l.cover)} alt="" className="aspect-[2/3] w-48 rounded-lg border border-gold/40 object-cover" />
              </button>
            ) : (
              <div className="flex aspect-[2/3] w-48 items-center justify-center rounded-lg border border-dashed border-line text-xs text-faint">まだありません</div>
            )}
          </div>
          <div className="min-w-64 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {plot.characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  className={cx('flex h-8 items-center gap-1.5 rounded-full border px-3 text-sm transition-colors', present.includes(c.id) ? 'border-gold/60 bg-gold/15 text-gold' : 'border-line text-faint hover:text-dim')}
                >
                  {present.includes(c.id) && <Icon name="check" size={12} />}
                  {c.name || '（名前なし）'}
                </button>
              ))}
              {player && <Toggle checked={withPlayer} onChange={setWithPlayer} label={`${T.player}も描く（${player.name}）`} />}
            </div>
            {nobody && <p className="text-xs text-danger">描く人を1人以上選んでください</p>}
            <TextArea rows={3} className="text-[13px]" value={request} placeholder="例 灯台の見える窓辺で、ミズキがエレナにコーヒーを差し出している。夕方の光" onChange={(e) => setRequest(e.target.value)} />
            <Button variant="primary" onClick={() => onCover(request.trim(), present, withPlayer && !!player)} disabled={coverBusy || !plot.characters.length || nobody}>
              {coverBusy ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="image" size={14} />} {coverBusy ? '描いています' : `${T.cover}を描く`}
            </Button>
            <ErrorText error={coverError} />
            {covers.length > 0 && (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {covers.map((t, i) => (
                  <div key={t.id} className="shrink-0 space-y-1">
                    <button type="button" onClick={() => onOpen(covers.map((x) => x.file), i)} className="block">
                      <img src={imageUrl(t.file)} alt="" className={cx('aspect-[2/3] h-36 rounded-md border object-cover', t.file === l.cover ? 'border-gold' : 'border-line')} />
                    </button>
                    {t.file === l.cover ? (
                      <Badge tone="gold">使っている絵</Badge>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => onUseCover(t.file)}>
                        これにする
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="flex justify-end gap-2">
        <Link to={`/plots/${plot.id}/edit`}>
          <Button>
            <Icon name="edit" size={13} /> 編集画面で確かめる
          </Button>
        </Link>
        <Link to={`/plots/${plot.id}`}>
          <Button variant="primary">
            <Icon name="play" size={13} /> {T.plot}を見る
          </Button>
        </Link>
      </div>
    </div>
  );
}
