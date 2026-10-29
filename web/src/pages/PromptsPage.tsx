import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DEFAULT_LLM_PROMPTS, DEFAULT_PRESET, DEFAULT_STYLE_TEXTS, type Preset } from '@archsage/shared';
import { api } from '../api.ts';
import { Page } from '../Layout.tsx';
import { T } from '../terms.ts';
import { Badge, Button, Card, ConfirmButton, cx, ErrorText, Field, Icon, Input, Tabs, TextArea } from '../ui.tsx';
import { useSettingsDraft } from './SettingsPage.tsx';

// LLMに渡す文をまとめて置くページ。語り手の指示は複数持って会話ごとに選び、ほかは全体で1組

type TabKey = 'narrator' | 'reply' | 'note' | 'illust' | 'summary' | 'wizard' | 'style';

// 内部プロンプトは鍵の頭で分ける
const PROMPT_GROUPS: { key: Exclude<TabKey, 'narrator' | 'style'>; label: string; prefixes: string[]; hint: string }[] = [
  { key: 'reply', label: '返答の形', prefixes: ['reply.'], hint: '会話の返答をJSONで受け取るための指示です。返答の形とモードに合わせて、システムプロンプトに入ります' },
  { key: 'note', label: '毎回の情報', prefixes: ['note.'], hint: '最後の発言の末尾に毎回足す、その場にいる人、場所、時間帯などの書き方です' },
  { key: 'illust', label: T.illust, prefixes: ['illust.', 'outfit.'], hint: `${T.illust}、${T.cover}、アバターを作るときに、補助のLLMに渡す指示です` },
  { key: 'summary', label: T.summary, prefixes: ['summary.'], hint: `長くなった履歴を${T.summary}にまとめるときの指示です` },
  { key: 'wizard', label: T.wizard, prefixes: ['wizard.'], hint: `${T.plot}を${T.wizard}するときに、候補を出させる指示です` },
];

const PROMPT_LABELS: Record<string, string> = {
  'reply.perLine': '1人1セリフ',
  'reply.free': '自由',
  'reply.common': 'JSONの共通の欄',
  'reply.rp': 'RPのときの決まり',
  'reply.novel': `${T.novel}のときの決まり`,
  'note.header': '毎回変わる情報の囲み',
  'note.present': 'その場にいる人',
  'note.location': '今の場所',
  'note.timeWeather': '時間帯と天気',
  'note.pinned': '手で直した状況',
  'note.instruction': T.instruction,
  'illust.system': '準備（システム）',
  'illust.cover': `${T.cover}を作るときに足す指示`,
  'illust.pov': '主観で描くときに足す指示',
  'illust.user': '準備（渡す内容）',
  'summary.system': 'システム',
  'summary.user': '渡す内容',
  'summary.merge': 'まとめ直し',
  'wizard.system': 'システム',
  'wizard.user': '渡す内容',
  'wizard.story': `${T.story}の候補`,
  'wizard.character': `${T.character}を1人作る`,
  'wizard.player': `${T.player}を作る`,
  'wizard.intro': `${T.intro}の候補`,
  'wizard.illust': `${T.illust}の設定（仕上げで、まだない人の分）`,
  'wizard.listing': `${T.listing}と${T.examples}`,
};

const STYLE_TEXT_LABELS: Record<string, string> = {
  'length.short': '応答の長さ: 短い',
  'length.medium': '応答の長さ: 普通',
  'length.long': '応答の長さ: 長い',
  'dialogueRatio.dialogue': '割合: 会話多め',
  'dialogueRatio.balanced': '割合: 半々',
  'dialogueRatio.narration': '割合: 地の文多め',
  'pace.slow': '進む速さ: ゆっくり',
  'pace.normal': '進む速さ: 普通',
  'pace.fast': '進む速さ: 速い',
  'person.third': '人称: 三人称',
  'person.first': '人称: 一人称',
};

const OVERRIDE_NOTE = 'どの会話でも使います。変えたものだけを保存し、空にすると既定に戻ります。{{name}} の置換と、{{#name}}…{{/name}}（値が空なら消す）が使えます';

export function PromptsPage() {
  const [tab, setTab] = useState<TabKey>('narrator');
  const { draft, set, dirty, save } = useSettingsDraft();
  const group = PROMPT_GROUPS.find((g) => g.key === tab);
  const narrator = useNarrator();

  return (
    <Page
      title={T.prompts}
      actions={
        tab === 'narrator' ? (
          narrator.actions
        ) : (
          <Button variant="primary" disabled={!draft || !dirty || save.isPending} onClick={() => draft && save.mutate(draft)}>
            {dirty ? '保存' : '保存済み'}
          </Button>
        )
      }
    >
      <Tabs
        className="mb-6"
        value={tab}
        onChange={setTab}
        tabs={[{ key: 'narrator', label: T.preset }, ...PROMPT_GROUPS.map((g) => ({ key: g.key, label: g.label })), { key: 'style', label: `${T.style}の定型文` }]}
      />
      {tab === 'narrator' && narrator.body}
      {tab !== 'narrator' && draft && (
        <div className="max-w-3xl">
          <ErrorText error={save.error} />
          {group && (
            <OverridesTab
              keys={Object.keys(DEFAULT_LLM_PROMPTS).filter((k) => group.prefixes.some((p) => k.startsWith(p)))}
              defaults={DEFAULT_LLM_PROMPTS}
              labels={PROMPT_LABELS}
              values={draft.llmPrompts}
              onChange={(v) => set((d) => void (d.llmPrompts = v))}
              hint={group.hint}
            />
          )}
          {tab === 'style' && (
            <OverridesTab
              keys={Object.keys(DEFAULT_STYLE_TEXTS)}
              defaults={DEFAULT_STYLE_TEXTS}
              labels={STYLE_TEXT_LABELS}
              values={draft.styleTexts}
              onChange={(v) => set((d) => void (d.styleTexts = v))}
              hint={`${T.style}の選択肢は、それぞれここの定型文に変わってプロンプトに入ります`}
            />
          )}
        </div>
      )}
    </Page>
  );
}

function OverridesTab({ keys, defaults, labels, values, onChange, hint }: { keys: string[]; defaults: Record<string, string>; labels: Record<string, string>; values: Record<string, string>; onChange: (v: Record<string, string>) => void; hint: string }) {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <p className="text-sm text-dim">{hint}</p>
        <p className="text-xs text-faint">{OVERRIDE_NOTE}</p>
      </div>
      {keys.map((k) => {
        const changed = k in values;
        return (
          <Field
            key={k}
            label={
              <span className="flex items-center gap-2">
                {labels[k] ?? k}
                {changed && <Badge tone="gold">変更あり</Badge>}
              </span>
            }
            right={
              changed && (
                <button
                  type="button"
                  className="text-xs text-faint hover:text-ink"
                  onClick={() => {
                    const next = { ...values };
                    delete next[k];
                    onChange(next);
                  }}
                >
                  既定に戻す
                </button>
              )
            }
          >
            <TextArea
              rows={Math.min(14, Math.max(2, (values[k] ?? defaults[k]).split('\n').length + 1))}
              value={values[k] ?? defaults[k]}
              className="font-mono text-xs"
              onChange={(e) => {
                const v = e.target.value;
                const next = { ...values };
                if (v === defaults[k] || v === '') delete next[k];
                else next[k] = v;
                onChange(next);
              }}
            />
          </Field>
        );
      })}
    </div>
  );
}

// 語り手の指示。ページの右上のボタンと中身を返す
function useNarrator() {
  const qc = useQueryClient();
  const presets = useQuery({ queryKey: ['presets'], queryFn: api.presets });
  const [sel, setSel] = useState('');
  const [draft, setDraft] = useState<Preset | null>(null);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const current = presets.data?.find((p) => p.id === sel) ?? presets.data?.find((p) => p.id === DEFAULT_PRESET.id) ?? presets.data?.[0];

  useEffect(() => {
    if (current && (!draft || draft.id !== current.id)) {
      setDraft(structuredClone(current));
      setDirty(false);
    }
  }, [current, draft]);

  const done = (p: Preset) => {
    qc.invalidateQueries({ queryKey: ['presets'] });
    setSel(p.id);
    setDraft(p);
    setDirty(false);
  };
  const create = useMutation({ mutationFn: (p: Partial<Preset>) => api.createPreset(p), onSuccess: done });
  const save = useMutation({ mutationFn: (p: Preset) => api.savePreset(p), onSuccess: done });
  const reset = useMutation({ mutationFn: (pid: string) => api.resetPreset(pid), onSuccess: done });
  const del = useMutation({
    mutationFn: (pid: string) => api.deletePreset(pid),
    onSuccess: () => {
      setSel('');
      setDraft(null);
      qc.invalidateQueries({ queryKey: ['presets'] });
    },
  });

  // 読み書きはJSON1つ
  const exportPreset = (p: Preset) => {
    const blob = new Blob([JSON.stringify({ name: p.name, systemPrompt: p.systemPrompt, postHistory: p.postHistory }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.name || 'preset'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const actions = (
    <>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (!f) return;
          try {
            const d = JSON.parse(await f.text()) as Partial<Preset>;
            create.mutate({ name: d.name ?? f.name.replace(/\.json$/, ''), systemPrompt: d.systemPrompt ?? '', postHistory: d.postHistory ?? '' });
          } catch {
            create.reset();
          }
        }}
      />
      <Button onClick={() => fileRef.current?.click()}>
        <Icon name="upload" /> 読み込む
      </Button>
      <Button variant="primary" onClick={() => create.mutate({ name: `新しい${T.preset}`, systemPrompt: DEFAULT_PRESET.systemPrompt, postHistory: '' })}>
        <Icon name="plus" /> 新しく作る
      </Button>
    </>
  );

  const body = (
    <>
      <p className="-mt-2 mb-5 text-sm text-dim">会話のシステムプロンプトの最初に入る、語り手への指示です。複数持てて、会話ごとに選べます。{'{{user}}'} と {'{{char}}'} が使えます。</p>
      <div className="grid gap-5 md:grid-cols-[200px_1fr]">
        <div className="space-y-1">
          {presets.data?.map((p) => (
            <button key={p.id} type="button" onClick={() => setSel(p.id)} className={cx('block w-full truncate rounded-md px-3 py-1.5 text-left text-sm', p.id === current?.id ? 'bg-panel2 text-gold' : 'text-dim hover:bg-panel hover:text-ink')}>
              {p.name}
            </button>
          ))}
        </div>
        {draft && (
          <Card className="space-y-4 p-5">
            <Field label="名前">
              <Input
                value={draft.name}
                onChange={(e) => {
                  setDraft({ ...draft, name: e.target.value });
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="システムプロンプト" hint="システムのいちばん最初に入ります">
              <TextArea
                rows={14}
                value={draft.systemPrompt}
                onChange={(e) => {
                  setDraft({ ...draft, systemPrompt: e.target.value });
                  setDirty(true);
                }}
              />
            </Field>
            <Field label="履歴の後の指示（postHistory）" hint="最後の発言の末尾の <system_note> に毎回入ります">
              <TextArea
                rows={4}
                value={draft.postHistory}
                onChange={(e) => {
                  setDraft({ ...draft, postHistory: e.target.value });
                  setDirty(true);
                }}
              />
            </Field>
            <ErrorText error={save.error ?? create.error} />
            <div className="flex flex-wrap justify-between gap-2">
              <div className="flex gap-2">
                {draft.id === DEFAULT_PRESET.id ? (
                  <ConfirmButton variant="subtle" onConfirm={() => reset.mutate(draft.id)} confirmLabel="もう一度押すと初期化します">
                    初期化
                  </ConfirmButton>
                ) : (
                  <ConfirmButton onConfirm={() => del.mutate(draft.id)}>
                    <Icon name="trash" size={13} /> 消す
                  </ConfirmButton>
                )}
                <Button size="sm" onClick={() => exportPreset(draft)}>
                  <Icon name="download" size={13} /> 書き出す
                </Button>
              </div>
              <Button variant="primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
                {dirty ? '保存' : '保存済み'}
              </Button>
            </div>
          </Card>
        )}
      </div>
    </>
  );

  return { actions, body };
}
