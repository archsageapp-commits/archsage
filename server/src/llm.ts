import type { Connection, ConnectionKind, LlmMessage, Sampling, JsonSchema, ProviderOption } from '@archsage/shared';

export const DEFAULT_BASE_URLS: Record<ConnectionKind, string> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: 'https://api.openai.com/v1',
  koboldcpp: 'http://127.0.0.1:5001/v1',
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
};

export interface LlmRequest {
  connection: Connection;
  model: string;
  messages: LlmMessage[];
  sampling: Sampling;
  schema?: { name: string; schema: JsonSchema };
  provider?: LlmProvider;
  timeoutMs?: number;
  signal?: AbortSignal; // 利用者が止めたとき
  onDelta?: (text: string, reasoning: string) => void; // 渡すとストリーミングで受け取り、届くたびにここまでの全文を渡す
}

// OpenRouterの提供元。onlyでなければ、まずそこへ送り、だめならほかへ回す
export interface LlmProvider {
  tag: string;
  only?: boolean;
}

export interface LlmResponse {
  text: string;
  reasoning?: string;
  finishReason?: string;
  usedSchema: boolean;
  requestBody: unknown;
}

export class LlmError extends Error {
  status?: number;
  body?: string;
  constructor(message: string, status?: number, body?: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// 利用者が止めた。text はそれまでに届いた分
export class LlmStopped extends LlmError {
  text: string;
  reasoning: string;
  constructor(text = '', reasoning = '') {
    super('止めました');
    this.text = text;
    this.reasoning = reasoning;
  }
}

function baseUrl(c: Connection): string {
  return (c.baseUrl.trim() || DEFAULT_BASE_URLS[c.kind]).replace(/\/+$/, '');
}

function headers(c: Connection): Record<string, string> {
  const h: Record<string, string> = { 'content-type': 'application/json' };
  if (c.apiKey) h.authorization = `Bearer ${c.apiKey}`;
  if (c.kind === 'openrouter') {
    h['HTTP-Referer'] = 'https://github.com/archsage';
    h['X-Title'] = 'Archsage';
  }
  return h;
}

export async function callLlm(req: LlmRequest): Promise<LlmResponse> {
  const useSchema = !!req.schema && req.connection.structuredOutputs;
  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    temperature: req.sampling.temperature,
    top_p: req.sampling.topP,
    max_tokens: req.sampling.maxTokens,
    stream: !!req.onDelta,
  };
  const provider: Record<string, unknown> = {};
  if (useSchema && req.schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: req.schema.name, strict: true, schema: req.schema.schema } };
    // OpenRouterでは、スキーマに対応した提供元だけに回す。対応先がなければエラーになり、呼ぶ側がスキーマなしでやり直す
    if (req.connection.kind === 'openrouter') provider.require_parameters = true;
  }
  // 提供元を決めてあれば、まずそこへ回す
  if (req.connection.kind === 'openrouter' && req.provider) {
    provider.order = [req.provider.tag];
    provider.allow_fallbacks = !req.provider.only;
  }
  if (Object.keys(provider).length) body.provider = provider;
  const timeout = AbortSignal.timeout(req.timeoutMs ?? 300_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl(req.connection)}/chat/completions`, {
      method: 'POST',
      headers: headers(req.connection),
      body: JSON.stringify(body),
      signal: req.signal ? AbortSignal.any([timeout, req.signal]) : timeout,
    });
  } catch (e) {
    if (req.signal?.aborted) throw new LlmStopped();
    throw new LlmError(`接続先に届きませんでした: ${(e as Error).message}`);
  }
  if (res.ok && req.onDelta && res.body && (res.headers.get('content-type') ?? '').includes('text/event-stream')) {
    return { ...(await readStream(res.body, req)), usedSchema: useSchema, requestBody: body };
  }
  let text: string;
  try {
    text = await res.text();
  } catch (e) {
    if (req.signal?.aborted) throw new LlmStopped();
    throw new LlmError(`接続先の応答が途中で切れました: ${(e as Error).message}`);
  }
  if (!res.ok) throw new LlmError(`接続先がエラーを返しました（${res.status}）: ${text.slice(0, 500)}`, res.status, text);
  let data: {
    choices?: { message?: { content?: string | null; reasoning?: string; reasoning_content?: string }; finish_reason?: string }[];
    error?: { message?: string };
  };
  try {
    data = JSON.parse(text);
  } catch {
    throw new LlmError(`接続先の応答を読めませんでした: ${text.slice(0, 300)}`);
  }
  if (data.error) throw new LlmError(`接続先がエラーを返しました: ${data.error.message ?? JSON.stringify(data.error)}`);
  const choice = data.choices?.[0];
  const message = choice?.message;
  return {
    text: message?.content ?? '',
    reasoning: message?.reasoning ?? message?.reasoning_content ?? undefined,
    finishReason: choice?.finish_reason,
    usedSchema: useSchema,
    requestBody: body,
  };
}

type StreamChunk = {
  choices?: { delta?: { content?: string | null; reasoning?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }[];
  error?: { message?: string };
};

// OpenAI互換のストリーミング（SSE の data: 行）を読む
async function readStream(stream: ReadableStream<Uint8Array>, req: LlmRequest): Promise<Pick<LlmResponse, 'text' | 'reasoning' | 'finishReason'>> {
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let reasoning = '';
  let finishReason: string | undefined;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      let changed = false;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        // 空行や「: OPENROUTER PROCESSING」のようなコメントは飛ばす
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data);
        } catch {
          continue;
        }
        if (chunk.error) throw new LlmError(`接続先がエラーを返しました: ${chunk.error.message ?? JSON.stringify(chunk.error)}`);
        const choice = chunk.choices?.[0];
        const delta = choice?.delta;
        if (delta?.content) text += delta.content;
        const r = delta?.reasoning ?? delta?.reasoning_content;
        if (r) reasoning += r;
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (delta?.content || r) changed = true;
      }
      if (changed) req.onDelta?.(text, reasoning);
    }
  } catch (e) {
    if (req.signal?.aborted) throw new LlmStopped(text, reasoning);
    if (e instanceof LlmError) throw e;
    throw new LlmError(`接続先の応答が途中で切れました: ${(e as Error).message}`);
  }
  return { text, reasoning: reasoning || undefined, finishReason };
}

// スキーマ付きで呼び、送信か解析に失敗したらスキーマなしで1回だけ再試行する
export async function callJson<T>(req: LlmRequest, parse: (text: string) => T): Promise<{ value: T; response: LlmResponse }> {
  let first: unknown;
  try {
    const response = await callLlm(req);
    return { value: parse(response.text), response };
  } catch (e) {
    first = e;
    if (!req.schema || !req.connection.structuredOutputs) throw e;
  }
  try {
    const response = await callLlm({ ...req, connection: { ...req.connection, structuredOutputs: false } });
    return { value: parse(response.text), response };
  } catch (e) {
    throw first instanceof Error ? new LlmError(`${first.message}（スキーマなしの再試行も失敗: ${(e as Error).message}）`) : e;
  }
}

export async function listModels(c: Connection): Promise<string[]> {
  const res = await fetch(`${baseUrl(c)}/models`, { headers: headers(c), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new LlmError(`モデルの一覧を取れませんでした（${res.status}）`, res.status);
  const data = (await res.json()) as { data?: { id: string }[]; models?: { name?: string; id?: string }[] };
  const items = data.data ?? data.models ?? [];
  return items.map((m) => ('id' in m && m.id ? m.id : ((m as { name?: string }).name ?? ''))).filter(Boolean).sort();
}

// 料金を並べるときの重み。RPでは入力（これまでの会話）が出力よりずっと長いので、入力を重く見る
const INPUT_WEIGHT = 4;

export function providerCost(p: ProviderOption): number {
  return p.inputPrice * INPUT_WEIGHT + p.outputPrice;
}

// OpenRouterで、そのモデルを出している提供元を安い順に返す
export async function listProviders(c: Connection, model: string): Promise<ProviderOption[]> {
  const res = await fetch(`${baseUrl(c)}/models/${model.split('/').map(encodeURIComponent).join('/')}/endpoints`, { headers: headers(c), signal: AbortSignal.timeout(20_000) });
  if (res.status === 404) throw new LlmError(`OpenRouterに「${model}」が見つかりません`, 404);
  if (!res.ok) throw new LlmError(`提供元の一覧を取れませんでした（${res.status}）`, res.status);
  const data = (await res.json()) as {
    data?: {
      endpoints?: {
        tag?: string;
        provider_name?: string;
        quantization?: string;
        context_length?: number;
        pricing?: { prompt?: string; completion?: string };
        supported_parameters?: string[];
        status?: number;
      }[];
    };
  };
  const perMillion = (v?: string) => (Number(v) || 0) * 1_000_000;
  return (data.data?.endpoints ?? [])
    .filter((e) => e.tag || e.provider_name)
    .map((e) => ({
      tag: e.tag || e.provider_name!,
      name: e.provider_name || e.tag!,
      quantization: e.quantization && e.quantization !== 'unknown' ? e.quantization : undefined,
      inputPrice: perMillion(e.pricing?.prompt),
      outputPrice: perMillion(e.pricing?.completion),
      structuredOutputs: !!e.supported_parameters?.includes('structured_outputs'),
      contextLength: e.context_length,
      down: (e.status ?? 0) < 0,
    }))
    .sort((a, b) => providerCost(a) - providerCost(b) || a.name.localeCompare(b.name));
}
