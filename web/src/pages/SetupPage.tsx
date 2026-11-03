import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { Settings } from '@archsage/shared';
import { ComfyEditor, ConnectionsEditor, newConnection, YouEditor, type DraftSettings } from '../components/SettingsParts.tsx';
import { ChoiceField, useComfyOptions, useSettingsDraft } from './SettingsPage.tsx';
import { T } from '../terms.ts';
import { Button, Card, cx, ErrorText, Field, Select } from '../ui.tsx';

const STEPS = [T.you, T.llm, T.imageGen];

// 初回の案内。「あなた → LLM → 画像生成」の順
export function SetupPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const { draft, set, save } = useSettingsDraft();

  const empty = draft?.connections.length === 0;
  useEffect(() => {
    // 最初はOpenRouterを1つ置いておく
    if (empty) set((d) => void d.connections.push(newConnection('openrouter')));
  }, [empty]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!draft) return null;

  const finish = async () => {
    const s = await save.mutateAsync({ ...draft, onboarded: true });
    qc.setQueryData(['settings'], s as Settings);
    nav('/');
  };

  const next = async () => {
    await save.mutateAsync(draft);
    setStep(step + 1);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <div className="mb-8 text-center">
          <img src="/favicon.svg" alt="" className="mx-auto mb-3 h-14 w-14" />
          <h1 className="text-2xl font-semibold text-gold-soft">Archsageへようこそ</h1>
          <p className="mt-1 text-sm text-dim">はじめに3つだけ設定します。あとから設定画面で変えられます。</p>
        </div>
        <div className="mb-6 flex items-center justify-center gap-2">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cx('flex h-7 items-center rounded-full px-3 text-xs', i === step ? 'bg-gold text-on-gold' : i < step ? 'bg-gold/15 text-gold' : 'bg-panel2 text-faint')}>
                {i + 1}. {s}
              </div>
              {i < STEPS.length - 1 && <div className="h-px w-6 bg-line" />}
            </div>
          ))}
        </div>
        <Card className="p-5">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-dim">遊ぶ{T.you}の名前と性別です。遊び始めるときに「{T.you}として遊ぶ」を選ぶと、{T.player}の名前がこの名前になります。</p>
              <YouEditor s={draft} set={set} />
            </div>
          )}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-dim">会話に使うLLMの{T.connection}です。OpenRouterやOpenAI互換のAPI、ローカルLLM（KoboldCpp、Ollama、LM Studio）が使えます。返答はJSONで受け取るので、JSONで返せるモデルを選んでください。</p>
              <ConnectionsEditor s={draft} set={set} compact />
            </div>
          )}
          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-dim">{T.illust}はComfyUIで作ります。Anima用のワークフローを同梱しているので、Animaのモデルが入っていればそのまま使えます。</p>
              <ComfyEditor s={draft} set={set} />
              <ModelPicker s={draft} set={set} />
            </div>
          )}
          <ErrorText error={save.error} />
          <div className="mt-6 flex justify-between">
            <Button variant="ghost" onClick={() => (step === 0 ? void finish() : setStep(step - 1))}>
              {step === 0 ? 'あとで設定する' : '戻る'}
            </Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" onClick={() => void next()} disabled={save.isPending}>
                次へ
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void finish()} disabled={save.isPending}>
                はじめる
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

// プリセットの名前から、ComfyUIに入っていそうなファイルを探す。Civitaiなどから入れたモデルはファイル名が初期値と違う
export function guessModel(profileId: string, list: string[]): string | undefined {
  const key = profileId === 'anima-base' ? 'base' : profileId === 'anima-turbo' ? 'turbo' : profileId === 'anima' ? 'aesthetic' : undefined;
  if (!key) return undefined;
  const norm = (f: string) => f.toLowerCase().replace(/[^a-z0-9]/g, '');
  const found = list.filter((f) => {
    const n = norm(f);
    return n.includes('anima') && n.includes(key) && !(key === 'turbo' && n.includes('noturbo'));
  });
  return found.find((f) => norm(f).startsWith('anima')) ?? (found.length === 1 ? found[0] : undefined);
}

// 使うプリセットと、そのモデルのファイル。ComfyUIに入っているファイルから選ぶので、名前の食い違いで描けないことがない
function ModelPicker({ s, set }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void }) {
  const options = useComfyOptions(s);
  const profile = s.imageProfiles.find((p) => p.id === s.imageProfileId) ?? s.imageProfiles[0];
  const pi = s.imageProfiles.indexOf(profile);
  const list = options.data?.choices.model;
  const missing = !!list?.length && !list.includes(profile.model);
  // 初期値のファイルがなければ、それらしいものを先に選んでおく
  useEffect(() => {
    if (!missing || !list) return;
    const guess = guessModel(profile.id, list);
    if (guess) set((d) => void (d.imageProfiles[pi].model = guess));
  }, [missing, profile.id, list?.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!list?.length) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="プリセット" hint="Animaの版ごとに、生成の値と品質タグをまとめて切り替えます">
        <Select value={profile.id} onChange={(e) => set((d) => void (d.imageProfileId = e.target.value))}>
          {s.imageProfiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </Field>
      <div className="space-y-1">
        <ChoiceField label="モデル" value={profile.model} list={list} current={options.data?.current.model} onChange={(v) => set((d) => void (d.imageProfiles[pi].model = v))} />
        <p className={cx('text-xs', missing ? 'text-danger' : 'text-faint')}>
          {missing ? 'このファイルはComfyUIに見つかりません。入れたモデルを選んでください' : 'ComfyUIに入っているモデルから選びます。Civitaiなどから入れたモデルも選べます'}
        </p>
      </div>
    </div>
  );
}
