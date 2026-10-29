import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FACELESS_TEXT, newId, type Connection, type ConnectionKind, type ModelRef, type ProviderOption, type Settings, type Sex } from '@archsage/shared';
import { api } from '../api.ts';
import { T } from '../terms.ts';
import { Badge, Button, Card, ConfirmButton, ErrorText, Field, Icon, Input, Segmented, Select, Spinner, Toggle } from '../ui.tsx';

export type DraftConnection = Omit<Connection, 'apiKey'> & { apiKey?: string | null };
export type DraftSettings = Omit<Settings, 'connections'> & { connections: DraftConnection[] };

// 利用者自身。名前と性別だけを聞き、見た目は聞かない
export function YouEditor({ s, set }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="名前" className="min-w-48 flex-1">
          <Input value={s.you.name} placeholder={T.you} onChange={(e) => set((d) => void (d.you.name = e.target.value))} />
        </Field>
        <Field label="性別">
          <Segmented<Sex>
            value={s.you.sex}
            options={[
              { value: 'male', label: '男性' },
              { value: 'female', label: '女性' },
            ]}
            onChange={(v) => set((d) => void (d.you.sex = v))}
          />
        </Field>
      </div>
      <p className="text-xs text-faint">
        {T.plot}を{T.wizard}するときに、{T.player}を{T.you}にできます。{T.player}の名前と性別にそのまま入り、{T.illust}では顔を描きません（{FACELESS_TEXT[s.you.sex]}）。作ったあとで名前を変えても、作った{T.plot}の{T.player}はそのままです。
      </p>
    </div>
  );
}

export const KIND_LABELS: Record<ConnectionKind, string> = {
  openrouter: 'OpenRouter',
  openai: 'OpenAI互換',
  koboldcpp: 'KoboldCpp',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
};

export const KIND_URLS: Record<ConnectionKind, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  koboldcpp: 'http://127.0.0.1:5001/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
};

const NEEDS_KEY: ConnectionKind[] = ['openrouter', 'openai'];

export function newConnection(kind: ConnectionKind = 'openrouter'): DraftConnection {
  return { id: newId(), name: KIND_LABELS[kind], kind, baseUrl: '', structuredOutputs: true };
}

function keyStateOf(c: DraftConnection) {
  return c.apiKey === null ? 'cleared' : c.apiKey ? 'new' : c.hasApiKey ? 'saved' : 'none';
}

// 打っている途中で何度も取りに行かないよう、止まってから少し待つ
function useSettled<T>(value: T, ms = 700): T {
  const [settled, setSettled] = useState(value);
  const json = JSON.stringify(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [json, ms]);
  return settled;
}

// 接続先のモデルの一覧。設定を開いたときに取り、更新ボタンで取り直す
function useModelList(c: DraftConnection | undefined) {
  const keyState = c ? keyStateOf(c) : 'none';
  const ready = !!c && (!NEEDS_KEY.includes(c.kind) || keyState === 'saved' || keyState === 'new');
  const key = useSettled(c ? [c.id, c.kind, c.baseUrl.trim(), keyState] : []);
  return useQuery({
    queryKey: ['models', ...key],
    queryFn: () => api.models(c!),
    enabled: ready && key[0] === c?.id,
    staleTime: 10 * 60_000,
    retry: false,
  });
}

// OpenRouterの提供元の一覧（安い順）
function useProviders(c: DraftConnection | undefined, model: string) {
  const settledModel = useSettled(model.trim());
  return useQuery({
    queryKey: ['providers', c?.baseUrl.trim(), settledModel],
    queryFn: () => api.providers(c!, settledModel),
    enabled: c?.kind === 'openrouter' && settledModel.includes('/'),
    staleTime: 10 * 60_000,
    retry: false,
  });
}

function ConnectionCard({ c, onChange, onRemove }: { c: DraftConnection; onChange: (c: DraftConnection) => void; onRemove: () => void }) {
  const models = useModelList(c);
  const count = models.data?.models.length ?? 0;
  // 開いたときに自動で取りに行った分の失敗は出さない（ローカルLLMを起動していないだけのことが多い）
  const [asked, setAsked] = useState(false);
  const keyState = keyStateOf(c);
  return (
    <Card className="space-y-3 p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_160px]">
        <Field label="名前">
          <Input value={c.name} onChange={(e) => onChange({ ...c, name: e.target.value })} />
        </Field>
        <Field label="種類">
          <Select value={c.kind} onChange={(e) => onChange({ ...c, kind: e.target.value as ConnectionKind, name: c.name === KIND_LABELS[c.kind] ? KIND_LABELS[e.target.value as ConnectionKind] : c.name })}>
            {(Object.keys(KIND_LABELS) as ConnectionKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="URL" hint={`空なら ${KIND_URLS[c.kind]}`}>
        <Input value={c.baseUrl} placeholder={KIND_URLS[c.kind]} onChange={(e) => onChange({ ...c, baseUrl: e.target.value })} />
      </Field>
      <Field
        label="APIキー"
        hint={NEEDS_KEY.includes(c.kind) ? 'このPCの中だけに保存し、画面には返しません' : 'ローカルLLMなら空でかまいません'}
        right={
          keyState === 'saved' ? (
            <span className="flex items-center gap-2">
              <Badge tone="ok">設定済み</Badge>
              <button type="button" className="text-xs text-faint hover:text-danger" onClick={() => onChange({ ...c, apiKey: null })}>
                消す
              </button>
            </span>
          ) : keyState === 'cleared' ? (
            <Badge tone="danger">保存すると消えます</Badge>
          ) : null
        }
      >
        <Input type="password" autoComplete="off" value={typeof c.apiKey === 'string' ? c.apiKey : ''} placeholder={keyState === 'saved' ? '変えるときだけ入力' : 'sk-…'} onChange={(e) => onChange({ ...c, apiKey: e.target.value || undefined })} />
      </Field>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle checked={c.structuredOutputs} onChange={(v) => onChange({ ...c, structuredOutputs: v })} label="スキーマで返答の形を固定する（structured outputs）" />
        <div className="flex items-center gap-2">
          {count > 0 && <span className="text-xs text-faint">{count}件のモデル</span>}
          <Button
            size="sm"
            onClick={() => {
              setAsked(true);
              void models.refetch();
            }}
            disabled={models.isFetching}
          >
            {models.isFetching ? <Spinner className="h-3 w-3" /> : <Icon name="refresh" size={13} />} モデルを更新
          </Button>
          <ConfirmButton onConfirm={onRemove}>
            <Icon name="trash" size={13} />
          </ConfirmButton>
        </div>
      </div>
      {asked && <ErrorText error={models.error} />}
    </Card>
  );
}

function usd(v: number): string {
  return `$${Number(v.toFixed(3))}`;
}

function providerLabel(p: ProviderOption): string {
  // 同じ提供元が地域や精度で分かれているので、tagの後ろ（fp4/us など）で見分ける
  const variant = p.tag.includes('/') ? p.tag.slice(p.tag.indexOf('/') + 1) : p.quantization;
  const notes = [variant, !p.structuredOutputs && '形の固定なし', p.down && '不調'].filter(Boolean).join('・');
  return `${p.name}${notes ? `（${notes}）` : ''}  入力 ${usd(p.inputPrice)} / 出力 ${usd(p.outputPrice)}`;
}

function ProviderPicker({ connection, value, onChange }: { connection: DraftConnection; value: ModelRef; onChange: (v: ModelRef) => void }) {
  const providers = useProviders(connection, value.model);
  const list = providers.data?.providers ?? [];
  const current = value.provider ?? '';
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <Select className="flex-1" value={current} onChange={(e) => onChange({ ...value, provider: e.target.value || undefined, providerOnly: e.target.value ? value.providerOnly : undefined })}>
          <option value="">提供元はおまかせ（OpenRouterが選ぶ）</option>
          {current && !list.some((p) => p.tag === current) && <option value={current}>{current}（一覧にありません）</option>}
          {list.map((p) => (
            <option key={p.tag} value={p.tag}>
              {providerLabel(p)}
            </option>
          ))}
        </Select>
        <Button size="sm" onClick={() => void providers.refetch()} disabled={providers.isFetching || !value.model.includes('/')} title="提供元を取り直す">
          {providers.isFetching ? <Spinner className="h-3 w-3" /> : <Icon name="refresh" size={13} />}
        </Button>
      </div>
      {current && <Toggle checked={!!value.providerOnly} onChange={(v) => onChange({ ...value, providerOnly: v || undefined })} label="この提供元だけに送る（混んでいてもほかへ回さない）" />}
      <p className="text-xs text-faint">料金は100万トークンあたりで、入力を4倍に見た安い順。決めた提供元へ先に送ります</p>
      <ErrorText error={providers.error} />
    </div>
  );
}

function ModelPicker({ label, hint, value, connections, onChange, optional }: { label: string; hint?: string; value?: ModelRef; connections: DraftConnection[]; onChange: (v: ModelRef | undefined) => void; optional?: boolean }) {
  const listId = `models-${label}`;
  const cid = value?.connectionId ?? '';
  const connection = connections.find((c) => c.id === cid);
  const models = useModelList(connection);
  return (
    <Field label={label} hint={hint}>
      <div className="grid gap-2 sm:grid-cols-[180px_1fr]">
        <Select value={cid} onChange={(e) => onChange(e.target.value ? { connectionId: e.target.value, model: value?.model ?? '' } : undefined)}>
          {optional ? <option value="">会話のモデルと同じ</option> : <option value="">（選ぶ）</option>}
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input list={listId} value={value?.model ?? ''} disabled={!cid} placeholder="モデル名（例 deepseek/deepseek-chat）" onChange={(e) => onChange({ connectionId: cid, model: e.target.value })} />
        <datalist id={listId}>
          {(models.data?.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>
      {connection?.kind === 'openrouter' && value?.model && (
        <div className="mt-2">
          <ProviderPicker connection={connection} value={value} onChange={onChange} />
        </div>
      )}
    </Field>
  );
}

export function ConnectionsEditor({ s, set, compact }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void; compact?: boolean }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        {s.connections.map((c, i) => (
          <ConnectionCard
            key={c.id}
            c={c}
            onChange={(nc) => set((d) => void (d.connections[i] = nc))}
            onRemove={() =>
              set((d) => {
                d.connections.splice(i, 1);
                if (d.chatModel?.connectionId === c.id) d.chatModel = undefined;
                if (d.utilModel?.connectionId === c.id) d.utilModel = undefined;
              })
            }
          />
        ))}
        <div className="flex flex-wrap gap-2">
          {(Object.keys(KIND_LABELS) as ConnectionKind[]).map((k) => (
            <Button key={k} size="sm" onClick={() => set((d) => void d.connections.push(newConnection(k)))}>
              <Icon name="plus" size={13} /> {KIND_LABELS[k]}
            </Button>
          ))}
        </div>
      </div>
      <ModelPicker
        label="会話のモデル"
        hint={`返答と、${T.plot}を${T.wizard}するときの候補に使います。JSONで返せるモデルを選んでください`}
        value={s.chatModel}
        connections={s.connections}
        onChange={(v) => set((d) => void (d.chatModel = v))}
      />
      {!compact && (
        <ModelPicker
          label="補助用のモデル"
          hint={`${T.illust}の準備と${T.summary}に使います。速くて安いモデルがおすすめです`}
          value={s.utilModel}
          connections={s.connections}
          optional
          onChange={(v) => set((d) => void (d.utilModel = v))}
        />
      )}
    </div>
  );
}

export function ComfyEditor({ s, set }: { s: DraftSettings; set: (fn: (s: DraftSettings) => void) => void }) {
  const [url, setUrl] = useState(s.comfy.url);
  const status = useQuery({ queryKey: ['comfyStatus', url], queryFn: () => api.comfyStatus(url), retry: false });
  return (
    <div className="space-y-4">
      <Field
        label="ComfyUIのURL"
        right={
          status.isFetching ? (
            <Spinner className="h-3 w-3" />
          ) : status.data?.ok ? (
            <Badge tone="ok">つながりました{status.data.version ? `（v${status.data.version}）` : ''}</Badge>
          ) : status.data ? (
            <Badge tone="danger">つながりません</Badge>
          ) : null
        }
        hint={status.data && !status.data.ok ? status.data.error : '「確かめる」でつながるか分かります'}
      >
        <div className="flex gap-2">
          <Input value={s.comfy.url} onChange={(e) => set((d) => void (d.comfy.url = e.target.value))} />
          <Button onClick={() => (url === s.comfy.url ? status.refetch() : setUrl(s.comfy.url))}>確かめる</Button>
        </div>
      </Field>
    </div>
  );
}
