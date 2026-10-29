import { newId, type ComfyNodeMap, type Lora, type NodeInput } from '@archsage/shared';

type Workflow = Record<string, { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } }>;

export class ComfyError extends Error {}

function isLink(v: unknown): v is [string, number] {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'string';
}

// API形式のワークフローか。画面用の形式（nodes と links を持つ）は受け付けない
export function validateWorkflow(w: unknown): asserts w is Workflow {
  if (!w || typeof w !== 'object' || Array.isArray(w)) throw new ComfyError('ワークフローのJSONの形が違います');
  const obj = w as Record<string, unknown>;
  if ('nodes' in obj && 'links' in obj) {
    throw new ComfyError('画面用の形式のワークフローです。ComfyUIの「Export (API)」で書き出したJSONを読み込んでください');
  }
  const nodes = Object.values(obj);
  if (nodes.length === 0 || !nodes.every((n) => n && typeof n === 'object' && 'class_type' in (n as object))) {
    throw new ComfyError('API形式のワークフローではありません');
  }
}

const MODEL_INPUTS = ['unet_name', 'ckpt_name'];

// プロンプト、シード、サイズ、モデルを入れるノードを探す
export function detectNodeMap(w: Workflow): ComfyNodeMap {
  const map: ComfyNodeMap = {};
  const textInputOf = (id: string): NodeInput | undefined => {
    const n = w[id];
    if (!n?.inputs) return undefined;
    if (typeof n.inputs.text === 'string') return { node: id, input: 'text' };
    // 間にノードがあればたどる
    for (const [k, v] of Object.entries(n.inputs)) {
      if (isLink(v) && (k === 'conditioning' || k === 'positive' || k === 'negative')) return textInputOf(v[0]);
    }
    return undefined;
  };
  // モデルの名前を持つノード。LoRAなどが間にあればたどる
  const modelInputOf = (id: string, depth = 0): NodeInput | undefined => {
    const n = w[id];
    if (!n?.inputs || depth > 10) return undefined;
    for (const k of MODEL_INPUTS) if (typeof n.inputs[k] === 'string') return { node: id, input: k };
    return isLink(n.inputs.model) ? modelInputOf(n.inputs.model[0], depth + 1) : undefined;
  };
  for (const [id, n] of Object.entries(w)) {
    const inputs = n.inputs ?? {};
    const isSampler = /KSampler|Sampler/i.test(n.class_type ?? '') && (isLink(inputs.positive) || isLink(inputs.negative));
    if (!isSampler) continue;
    if (isLink(inputs.positive)) map.positive = textInputOf(inputs.positive[0]);
    if (isLink(inputs.negative)) map.negative = textInputOf(inputs.negative[0]);
    if (isLink(inputs.model)) map.model = modelInputOf(inputs.model[0]);
    if (typeof inputs.seed === 'number') map.seed = { node: id, input: 'seed' };
    else if (typeof inputs.noise_seed === 'number') map.seed = { node: id, input: 'noise_seed' };
    if (typeof inputs.steps === 'number') map.steps = { node: id, input: 'steps' };
    if (typeof inputs.cfg === 'number') map.cfg = { node: id, input: 'cfg' };
    if (typeof inputs.sampler_name === 'string') map.sampler = { node: id, input: 'sampler_name' };
    if (typeof inputs.scheduler === 'string') map.scheduler = { node: id, input: 'scheduler' };
    if (isLink(inputs.latent_image)) {
      const latent = w[inputs.latent_image[0]];
      if (latent?.inputs && typeof latent.inputs.width === 'number') {
        map.width = { node: inputs.latent_image[0], input: 'width' };
        map.height = { node: inputs.latent_image[0], input: 'height' };
      }
    }
    break;
  }
  // 見つからなければ題名から探す
  for (const [id, n] of Object.entries(w)) {
    const title = (n._meta?.title ?? '').toLowerCase();
    if (!map.positive && /positive/.test(title) && typeof n.inputs?.text === 'string') map.positive = { node: id, input: 'text' };
    if (!map.negative && /negative/.test(title) && typeof n.inputs?.text === 'string') map.negative = { node: id, input: 'text' };
    const modelKey = MODEL_INPUTS.find((k) => typeof n.inputs?.[k] === 'string');
    if (!map.model && modelKey) map.model = { node: id, input: modelKey };
  }
  return map;
}

export interface ComfyJob {
  positive: string;
  negative: string;
  seed: number;
  width: number;
  height: number;
  // 以下は空ならワークフローのまま
  model?: string;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
  loras?: Lora[];
}

function setInput(w: Workflow, ref: NodeInput | undefined, value: unknown): void {
  if (!ref) return;
  const n = w[ref.node];
  if (!n) throw new ComfyError(`ワークフローにノード ${ref.node} がありません`);
  n.inputs = { ...(n.inputs ?? {}), [ref.input]: value };
}

export function fillWorkflow(workflow: Workflow, map: ComfyNodeMap, job: ComfyJob): Workflow {
  if (!map.positive) throw new ComfyError('プロンプトを入れるノードが決まっていません。設定の「画像生成」で指定してください');
  const w = structuredClone(workflow);
  setInput(w, map.positive, job.positive);
  setInput(w, map.negative, job.negative);
  setInput(w, map.seed, job.seed);
  setInput(w, map.width, job.width);
  setInput(w, map.height, job.height);
  if (job.model) setInput(w, map.model, job.model);
  if (job.steps) setInput(w, map.steps, job.steps);
  if (job.cfg) setInput(w, map.cfg, job.cfg);
  if (job.sampler) setInput(w, map.sampler, job.sampler);
  if (job.scheduler) setInput(w, map.scheduler, job.scheduler);
  addLoras(w, map, job.loras ?? []);
  return w;
}

// LoRAのノードをサンプラーの手前に順に挟む。Animaの LoRA は文字の側を持たないので、モデルだけに掛ける
function addLoras(w: Workflow, map: ComfyNodeMap, loras: Lora[]): void {
  const list = loras.filter((l) => l.name.trim());
  if (list.length === 0) return;
  const ids = [map.steps?.node, map.cfg?.node, map.seed?.node].filter((id): id is string => !!id);
  const samplerId =
    ids.find((id) => isLink(w[id]?.inputs?.model)) ??
    Object.keys(w).find((id) => {
      const inputs = w[id].inputs ?? {};
      return isLink(inputs.model) && (isLink(inputs.positive) || isLink(inputs.conditioning));
    });
  const sampler = samplerId ? w[samplerId] : undefined;
  if (!sampler?.inputs || !isLink(sampler.inputs.model)) throw new ComfyError('LoRAを入れるところ（サンプラーのモデルの入力）がワークフローに見つかりません');
  let next = Math.max(0, ...Object.keys(w).map(Number).filter(Number.isFinite)) + 1;
  let from: [string, number] = sampler.inputs.model;
  for (const l of list) {
    const id = String(next++);
    w[id] = { class_type: 'LoraLoaderModelOnly', inputs: { lora_name: l.name.trim(), strength_model: l.strength, model: from }, _meta: { title: 'Load LoRA' } };
    from = [id, 0];
  }
  sampler.inputs.model = from;
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 48);
}

function base(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export async function comfyStatus(url: string): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const res = await fetch(`${base(url)}/system_stats`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false, error: `ComfyUIがエラーを返しました（${res.status}）` };
    const data = (await res.json()) as { system?: { comfyui_version?: string } };
    return { ok: true, version: data.system?.comfyui_version };
  } catch (e) {
    return { ok: false, error: `ComfyUIに届きませんでした: ${(e as Error).message}` };
  }
}

// ノードの欄で選べる値（モデルのファイル、サンプラーなど）。ComfyUIがその欄に入れられるものの一覧を返す
export async function comfyChoices(url: string, classType: string, input: string): Promise<string[]> {
  let res: Response;
  try {
    res = await fetch(`${base(url)}/object_info/${encodeURIComponent(classType)}`, { signal: AbortSignal.timeout(10_000) });
  } catch (e) {
    throw new ComfyError(`ComfyUIに届きませんでした: ${(e as Error).message}`);
  }
  if (!res.ok) throw new ComfyError(`ComfyUIがエラーを返しました（${res.status}）`);
  const data = (await res.json()) as Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>;
  const spec = data[classType]?.input;
  const choices = (spec?.required?.[input] ?? spec?.optional?.[input]) as unknown;
  return Array.isArray(choices) && Array.isArray(choices[0]) ? choices[0].filter((v): v is string => typeof v === 'string') : [];
}

interface HistoryEntry {
  outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: [string, Record<string, unknown>][] };
}

async function fetchHistory(url: string, promptId: string): Promise<HistoryEntry | undefined> {
  const res = await fetch(`${base(url)}/history/${promptId}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return undefined;
  const data = (await res.json()) as Record<string, HistoryEntry>;
  return data[promptId];
}

// ワークフローを送り、できた最初の画像を返す
export async function runComfy(url: string, workflow: Workflow, onProgress: (p: number) => void, timeoutMs = 600_000): Promise<{ data: Buffer; ext: string }> {
  const clientId = newId(16);
  const wsUrl = `${base(url).replace(/^http/, 'ws')}/ws?clientId=${clientId}`;
  let ws: WebSocket | undefined;
  let finished = false;
  let wsError: string | undefined;
  let promptId: string | undefined;
  const done = new Promise<void>((resolve) => {
    try {
      ws = new WebSocket(wsUrl);
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        let msg: { type: string; data?: Record<string, unknown> };
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        const d = msg.data ?? {};
        if (promptId && d.prompt_id && d.prompt_id !== promptId) return;
        if (msg.type === 'progress' && typeof d.value === 'number' && typeof d.max === 'number' && d.max > 0) onProgress(d.value / d.max);
        if (msg.type === 'executing' && d.node === null && d.prompt_id === promptId) {
          finished = true;
          resolve();
        }
        if (msg.type === 'execution_success' && d.prompt_id === promptId) {
          finished = true;
          resolve();
        }
        if (msg.type === 'execution_error' && d.prompt_id === promptId) {
          wsError = String(d.exception_message ?? 'ComfyUIで生成に失敗しました');
          finished = true;
          resolve();
        }
      };
      ws.onerror = () => {
        // WebSocket が使えなくても、履歴をのぞいて終わりを待つ
      };
    } catch {
      // 同上
    }
  });
  await new Promise<void>((r) => {
    if (!ws) return r();
    ws.onopen = () => r();
    setTimeout(r, 3000);
  });

  try {
    const res = await fetch(`${base(url)}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal: AbortSignal.timeout(30_000),
    }).catch((e: unknown) => {
      // 「fetch failed」だけでは分からないので、何を確かめればよいかを書く
      throw new ComfyError(`ComfyUI（${base(url)}）につながりません。起動しているか、設定の「画像生成」のURLを確かめてください（${(e as Error).message}）`);
    });
    const text = await res.text();
    if (!res.ok) throw new ComfyError(`ComfyUIがワークフローを受け付けませんでした（${res.status}）: ${text.slice(0, 500)}`);
    const data = JSON.parse(text) as { prompt_id?: string; node_errors?: Record<string, unknown> };
    if (!data.prompt_id) throw new ComfyError(`ComfyUIの応答に prompt_id がありません: ${text.slice(0, 300)}`);
    promptId = data.prompt_id;

    const started = Date.now();
    let entry: HistoryEntry | undefined;
    while (Date.now() - started < timeoutMs) {
      await Promise.race([done, new Promise((r) => setTimeout(r, finished ? 0 : 1500))]);
      if (wsError) throw new ComfyError(wsError);
      entry = await fetchHistory(url, promptId);
      if (entry?.status?.status_str === 'error') {
        const err = entry.status.messages?.find((m) => m[0] === 'execution_error')?.[1];
        throw new ComfyError(String(err?.exception_message ?? 'ComfyUIで生成に失敗しました'));
      }
      if (entry?.outputs && Object.values(entry.outputs).some((o) => o.images?.length)) break;
      entry = undefined;
    }
    if (!entry?.outputs) throw new ComfyError('ComfyUIの生成が時間内に終わりませんでした');
    const img = Object.values(entry.outputs).flatMap((o) => o.images ?? [])[0];
    const q = new URLSearchParams({ filename: img.filename, subfolder: img.subfolder, type: img.type });
    const view = await fetch(`${base(url)}/view?${q}`, { signal: AbortSignal.timeout(60_000) });
    if (!view.ok) throw new ComfyError(`画像を受け取れませんでした（${view.status}）`);
    const buf = Buffer.from(await view.arrayBuffer());
    const ext = (img.filename.split('.').pop() ?? 'png').toLowerCase();
    onProgress(1);
    return { data: buf, ext };
  } finally {
    try {
      ws?.close();
    } catch {
      // 閉じられなくても困らない
    }
  }
}
