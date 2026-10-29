import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_IMAGE_PROFILES, newId, type ComfyNodeMap, type ImageProfile, type Lora, type Settings } from '@archsage/shared';
import { api, type WorkflowNode } from '../api.ts';
import { ComfyEditor, ConnectionsEditor, YouEditor, type DraftSettings } from '../components/SettingsParts.tsx';
import { SiteSettings } from '../components/SiteSettings.tsx';
import { Page } from '../Layout.tsx';
import { T } from '../terms.ts';
import { Badge, Button, Card, ConfirmButton, ErrorText, Field, Icon, Input, Select, Tabs, TextArea, Toggle } from '../ui.tsx';

type TabKey = 'connection' | 'illust' | 'you' | 'site' | 'data';

export function useSettingsDraft() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [draft, setDraft] = useState<DraftSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (q.data && !dirty) setDraft(structuredClone(q.data));
  }, [q.data, dirty]);
  const set = (fn: (s: DraftSettings) => void) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      fn(next);
      return next;
    });
    setDirty(true);
  };
  const save = useMutation({
    mutationFn: (s: DraftSettings) => api.saveSettings(s),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      qc.invalidateQueries({ queryKey: ['comfyStatus'] });
      setDraft(structuredClone(s));
      setDirty(false);
    },
  });
  return { draft, set, dirty, save, setDirty };
}

export function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('connection');
  const { draft, set, dirty, save } = useSettingsDraft();
  if (!draft) return null;
  return (
    <Page
      title="設定"
      narrow
      actions={
        <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
          {dirty ? '保存' : '保存済み'}
        </Button>
      }
    >
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[
          { key: 'connection', label: T.llm },
          { key: 'illust', label: T.imageGen },
          { key: 'you', label: T.you },
          { key: 'site', label: T.site },
          { key: 'data', label: 'データ' },
        ]}
      />
      <ErrorText error={save.error} />
      {tab === 'connection' && <ConnectionTab s={draft} set={set} />}
      {tab === 'illust' && <IllustTab s={draft} set={set} onSaved={(s) => set((d) => Object.assign(d, { comfy: s.comfy }))} />}
      {tab === 'you' && <YouEditor s={draft} set={set} />}
      {tab === 'site' && <SiteSettings s={draft} set={set} />}
      {tab === 'data' && <DataTab />}
    </Page>
  );
}

function ConnectionTab({ s, set }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void }) {
  return (
    <div className="space-y-8">
      <ConnectionsEditor s={s} set={set} />
      <section className="space-y-4">
        <h2 className="text-[15px] font-semibold">送る量と生成の設定</h2>
        <Toggle checked={s.stream} onChange={(v) => set((d) => void (d.stream = v))} label="返答を書きながら表示する（ストリーミング）" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="温度（temperature）">
            <Input type="number" step="0.05" min="0" max="2" value={s.sampling.temperature} onChange={(e) => set((d) => void (d.sampling.temperature = Number(e.target.value)))} />
          </Field>
          <Field label="top_p">
            <Input type="number" step="0.01" min="0" max="1" value={s.sampling.topP} onChange={(e) => set((d) => void (d.sampling.topP = Number(e.target.value)))} />
          </Field>
          <Field label="返答の上限トークン">
            <Input type="number" step="128" min="256" value={s.sampling.maxTokens} onChange={(e) => set((d) => void (d.sampling.maxTokens = Number(e.target.value)))} />
          </Field>
          <Field label="送るトークンの上限" hint="モデルのコンテキスト長に合わせる">
            <Input type="number" step="1000" min="2000" value={s.contextTokens} onChange={(e) => set((d) => void (d.contextTokens = Number(e.target.value)))} />
          </Field>
          <Field label={`${T.lorebook}を探す発言の数`}>
            <Input type="number" min="1" max="50" value={s.loreScanDepth} onChange={(e) => set((d) => void (d.loreScanDepth = Number(e.target.value)))} />
          </Field>
          <Field label="長くなった履歴">
            <Select value={s.historyMode} onChange={(e) => set((d) => void (d.historyMode = e.target.value as Settings['historyMode']))}>
              <option value="summarize">{T.summary}にまとめる</option>
              <option value="truncate">古い方から切り捨てる</option>
            </Select>
          </Field>
        </div>
      </section>
    </div>
  );
}

const MAP_KEYS: { key: keyof ComfyNodeMap; label: string }[] = [
  { key: 'positive', label: 'プロンプト' },
  { key: 'negative', label: 'ネガティブ' },
  { key: 'seed', label: 'シード' },
  { key: 'width', label: '幅' },
  { key: 'height', label: '高さ' },
  { key: 'model', label: 'モデル' },
  { key: 'steps', label: 'ステップ数' },
  { key: 'cfg', label: 'CFG' },
  { key: 'sampler', label: 'サンプラー' },
  { key: 'scheduler', label: 'スケジューラー' },
];

function NodeMapEditor({ map, nodes, onChange }: { map: ComfyNodeMap; nodes: WorkflowNode[]; onChange: (m: ComfyNodeMap) => void }) {
  return (
    <div className="space-y-2">
      {MAP_KEYS.map(({ key, label }) => {
        const ref = map[key];
        const node = nodes.find((n) => n.id === ref?.node);
        return (
          <div key={key} className="grid grid-cols-[110px_1fr_140px] items-center gap-2">
            <span className="text-sm">{label}</span>
            <Select value={ref?.node ?? ''} onChange={(e) => onChange({ ...map, [key]: e.target.value ? { node: e.target.value, input: nodes.find((n) => n.id === e.target.value)?.inputs[0] ?? '' } : undefined })}>
              <option value="">（入れない）</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.id}: {n.title || n.classType}
                </option>
              ))}
            </Select>
            <Select value={ref?.input ?? ''} disabled={!node} onChange={(e) => ref && onChange({ ...map, [key]: { node: ref.node, input: e.target.value } })}>
              {(node?.inputs ?? []).map((i) => (
                <option key={i}>{i}</option>
              ))}
            </Select>
          </div>
        );
      })}
    </div>
  );
}

// ComfyUIが返す選択肢から選ぶ。ComfyUIにつながらないときは手で書く。空ならワークフローに書いてある値
function ChoiceField({ label, value, list, current, onChange }: { label: string; value: string; list?: string[]; current?: string | number; onChange: (v: string) => void }) {
  const keep = `ワークフローのまま${current ? `（${current}）` : ''}`;
  return (
    <Field label={label}>
      {list?.length ? (
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{keep}</option>
          {value && !list.includes(value) && <option value={value}>{value}（ComfyUIに見つかりません）</option>}
          {list.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </Select>
      ) : (
        <Input value={value} placeholder={keep} onChange={(e) => onChange(e.target.value.trim())} />
      )}
    </Field>
  );
}

function useComfyOptions(s: DraftSettings) {
  return useQuery({
    queryKey: ['comfyOptions', s.comfy.url, s.comfy.workflowName, JSON.stringify(s.comfy.nodeMap)],
    queryFn: () => api.comfyOptions(s.comfy.url),
    retry: false,
  });
}

function PresetSection({ s, set }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void }) {
  const options = useComfyOptions(s);
  const profile = s.imageProfiles.find((p) => p.id === s.imageProfileId) ?? s.imageProfiles[0];
  const pi = s.imageProfiles.indexOf(profile);
  const setProfile = (fn: (p: ImageProfile) => void) => set((d) => fn(d.imageProfiles[pi]));
  const builtin = DEFAULT_IMAGE_PROFILES.find((p) => p.id === profile.id);
  const choices = options.data?.choices ?? {};
  const current = options.data?.current ?? {};

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">プリセット</h2>
          <p className="text-xs text-faint">Animaの版ごとに、モデル、生成の値、品質タグ、ネガティブをまとめて切り替えます</p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            set((d) => {
              const copy = { ...structuredClone(profile), id: newId(), name: `${profile.name}のコピー` };
              d.imageProfiles.push(copy);
              d.imageProfileId = copy.id;
            })
          }
        >
          <Icon name="copy" size={13} /> 複製
        </Button>
      </div>
      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="使うプリセット">
            <Select value={profile.id} onChange={(e) => set((d) => void (d.imageProfileId = e.target.value))}>
              {s.imageProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="名前">
            <Input value={profile.name} onChange={(e) => setProfile((p) => void (p.name = e.target.value))} />
          </Field>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <ChoiceField label="モデル" value={profile.model} list={choices.model} current={current.model} onChange={(v) => setProfile((p) => void (p.model = v))} />
          </div>
          <Button className="shrink-0" onClick={() => void options.refetch()} disabled={options.isFetching}>
            読み直す
          </Button>
        </div>
        {options.data?.error && <p className="text-xs text-danger">{options.data.error}</p>}
        <ErrorText error={options.error} />
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Field label="ステップ数">
            <Input type="number" min="1" max="150" value={profile.steps || ''} placeholder={current.steps ? String(current.steps) : ''} onChange={(e) => setProfile((p) => void (p.steps = Number(e.target.value)))} />
          </Field>
          <Field label="CFG">
            <Input type="number" step="0.1" min="0" max="30" value={profile.cfg || ''} placeholder={current.cfg ? String(current.cfg) : ''} onChange={(e) => setProfile((p) => void (p.cfg = Number(e.target.value)))} />
          </Field>
          <ChoiceField label="サンプラー" value={profile.sampler} list={choices.sampler} current={current.sampler} onChange={(v) => setProfile((p) => void (p.sampler = v))} />
          <ChoiceField label="スケジューラー" value={profile.scheduler} list={choices.scheduler} current={current.scheduler} onChange={(v) => setProfile((p) => void (p.scheduler = v))} />
        </div>
        <Field label="品質タグ" hint="プロンプトの先頭に入ります">
          <Input value={profile.qualityTags} onChange={(e) => setProfile((p) => void (p.qualityTags = e.target.value))} />
        </Field>
        <Field label="ネガティブ" hint={profile.cfg === 1 ? 'CFGが1のときは、ネガティブは効きません' : undefined}>
          <TextArea rows={2} value={profile.negative} onChange={(e) => setProfile((p) => void (p.negative = e.target.value))} />
        </Field>
        <div className="flex justify-end">
          {builtin ? (
            <Button size="sm" variant="ghost" onClick={() => setProfile((p) => void Object.assign(p, structuredClone(builtin)))}>
              初期値に戻す
            </Button>
          ) : (
            <ConfirmButton
              onConfirm={() =>
                set((d) => {
                  d.imageProfiles.splice(pi, 1);
                  d.imageProfileId = d.imageProfiles[0].id;
                })
              }
            >
              <Icon name="trash" size={13} /> このプリセットを消す
            </ConfirmButton>
          )}
        </div>
      </Card>
    </section>
  );
}

// LoRAはプリセットによらず、どのプリセットでも掛ける
function LoraSection({ s, set }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void }) {
  const list = useComfyOptions(s).data?.choices.lora;
  const setLoras = (fn: (l: Lora[]) => void) => set((d) => fn(d.comfy.loras));
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-[15px] font-semibold">LoRA</h2>
          <p className="text-xs text-faint">どのプリセットでも、サンプラーの手前に上から順に挟みます。きっかけの語が要るものは、プリセットの品質タグかシナリオの画風タグに書いてください</p>
        </div>
        <Button size="sm" onClick={() => setLoras((l) => void l.push({ name: '', strength: 1 }))}>
          <Icon name="plus" size={13} /> 足す
        </Button>
      </div>
      {s.comfy.loras.length > 0 && (
        <Card className="space-y-2 p-4">
          <div className="grid grid-cols-[1fr_90px_32px] gap-2 text-xs text-dim">
            <span>ファイル</span>
            <span>強さ</span>
          </div>
          {s.comfy.loras.map((l, i) => (
            <div key={i} className="grid grid-cols-[1fr_90px_32px] items-center gap-2">
              {list?.length ? (
                <Select value={l.name} onChange={(e) => setLoras((ls) => void (ls[i].name = e.target.value))}>
                  <option value="">（選ぶ）</option>
                  {l.name && !list.includes(l.name) && <option value={l.name}>{l.name}（ComfyUIに見つかりません）</option>}
                  {list.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input value={l.name} placeholder="ファイル名（例 style.safetensors）" onChange={(e) => setLoras((ls) => void (ls[i].name = e.target.value.trim()))} />
              )}
              <Input type="number" step="0.05" value={l.strength} onChange={(e) => setLoras((ls) => void (ls[i].strength = Number(e.target.value)))} />
              <Button size="sm" variant="ghost" title="外す" onClick={() => setLoras((ls) => void ls.splice(i, 1))}>
                <Icon name="x" size={13} />
              </Button>
            </div>
          ))}
        </Card>
      )}
    </section>
  );
}

function IllustTab({ s, set, onSaved }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void; onSaved: (s: Settings) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const nodes = useQuery({ queryKey: ['workflowNodes', s.comfy.workflowName], queryFn: api.workflowNodes });
  const loaded = (ns: Settings) => {
    qc.setQueryData(['settings'], ns);
    onSaved(ns);
    qc.invalidateQueries({ queryKey: ['workflowNodes'] });
    qc.invalidateQueries({ queryKey: ['comfyOptions'] });
  };
  const load = useMutation({
    mutationFn: async (f: File) => api.loadWorkflow(JSON.parse(await f.text()), f.name),
    onSuccess: loaded,
  });
  const reset = useMutation({ mutationFn: api.resetWorkflow, onSuccess: loaded });

  return (
    <div className="space-y-8">
      <ComfyEditor s={s} set={set} />
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">大きさ</h2>
        <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
          <Field label="幅">
            <Input type="number" step="64" value={s.comfy.width} onChange={(e) => set((d) => void (d.comfy.width = Number(e.target.value)))} />
          </Field>
          <Field label="高さ">
            <Input type="number" step="64" value={s.comfy.height} onChange={(e) => set((d) => void (d.comfy.height = Number(e.target.value)))} />
          </Field>
        </div>
        <p className="text-xs text-faint">{T.illust}の大きさです。サムネイルとアバターは決まった大きさで作ります</p>
      </section>
      <PresetSection s={s} set={set} />
      <LoraSection s={s} set={set} />
      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold">ワークフロー</h2>
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              {s.comfy.workflow ? (
                <span>
                  {s.comfy.workflowName} <Badge>読み込んだもの</Badge>
                </span>
              ) : (
                <span>
                  Anima <Badge tone="gold">同梱</Badge>
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) load.mutate(f);
                e.target.value = '';
              }}
            />
            <Button size="sm" onClick={() => fileRef.current?.click()}>
              <Icon name="upload" size={13} /> 読み込む
            </Button>
            {s.comfy.workflow && (
              <Button size="sm" onClick={() => reset.mutate()}>
                同梱のものに戻す
              </Button>
            )}
          </div>
          <p className="text-xs text-faint">ComfyUIの「Export (API)」で書き出したJSONを読み込みます。同梱のものでできないことをしたいときに使います。プロンプトやプリセットの値を入れるノードは自動で探します。違っていたら下で直してください。</p>
          <ErrorText error={load.error ?? reset.error} />
          {s.comfy.workflow && nodes.data && <NodeMapEditor map={s.comfy.nodeMap} nodes={nodes.data.nodes} onChange={(m) => set((d) => void (d.comfy.nodeMap = m))} />}
        </Card>
      </section>
    </div>
  );
}

function DataTab() {
  const info = useQuery({ queryKey: ['info'], queryFn: api.info });
  const open = useMutation({ mutationFn: api.openDataDir });
  return (
    <div className="space-y-4">
      <p className="text-sm text-dim">チャットも画像も、すべてこのフォルダに保存しています。バックアップは、アプリを閉じてからこのフォルダをコピーするだけです。</p>
      <Card className="space-y-3 p-4">
        <Field label="データフォルダ">
          <div className="flex gap-2">
            <Input readOnly value={info.data?.dataDir ?? ''} className="font-mono text-xs" />
            <Button onClick={() => open.mutate()}>
              <Icon name="book" size={14} /> 開く
            </Button>
          </div>
        </Field>
        <div className="text-xs text-faint">
          Archsage {info.data?.version} ・ データの版 {info.data?.schemaVersion}
        </div>
        <ErrorText error={open.error} />
      </Card>
    </div>
  );
}
