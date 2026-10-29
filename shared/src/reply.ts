import type { ReplyFormat, ReplyPart } from './types.ts';
import { parsePartialJson, partialJsonBody } from './partialJson.ts';

export type JsonSchema = Record<string, unknown>;

const STRING = { type: 'string' };

function commonProperties(): Record<string, JsonSchema> {
  return {
    present: { type: 'array', items: STRING },
    location: STRING,
    time: STRING,
    weather: STRING,
    changes: STRING,
  };
}

// 1人1セリフの欄。欄の数は話せる人数ぶん
export function perLineFieldNames(slots: number): string[] {
  const names: string[] = [];
  for (let i = 0; i < slots; i++) names.push(`narration_${i}`, `speaker_${i}`, `line_${i}`);
  names.push(`narration_${slots}`);
  return names;
}

export function replySchema(format: ReplyFormat, slots: number): JsonSchema {
  const props: Record<string, JsonSchema> = {};
  if (format === 'perLine') {
    for (const name of perLineFieldNames(Math.max(1, slots))) props[name] = STRING;
  } else {
    props.parts = {
      type: 'array',
      items: {
        type: 'object',
        properties: { kind: { type: 'string', enum: ['narration', 'line'] }, speaker: STRING, text: STRING },
        required: ['kind', 'speaker', 'text'],
        additionalProperties: false,
      },
    };
  }
  Object.assign(props, commonProperties());
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

// 文章からJSONを取り出す。```json の囲みや前後の文も許す
export function extractJson(raw: string): unknown {
  // 考える過程を本文に混ぜて返すモデルがあるので、先に取り除く
  const text = raw
    .replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, '')
    .replace(/^[\s\S]*?<\/(think|thinking)>/i, '')
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    // 続けて探す
  }
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) {
    try {
      return JSON.parse(fence[1].trim());
    } catch {
      // 続けて探す
    }
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const body = text.slice(start, end + 1);
    try {
      return JSON.parse(body);
    } catch {
      return JSON.parse(body.replace(/,\s*([}\]])/g, '$1'));
    }
  }
  throw new Error('返答にJSONが見つかりません');
}

export interface ParsedReply {
  parts: ReplyPart[];
  present?: string[]; // 名前
  location?: string;
  time?: string;
  weather?: string;
  changes?: string;
}

export interface NameResolver {
  // 名前から personId を引く。見つからなければ undefined
  (name: string): string | undefined;
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

// 地の文の中に、セリフの欄と同じセリフが「名前「…」」の形で書かれていたら、その行を消す。
// 本文から推測して分けることはせず、セリフの欄とまったく同じものだけを消す
function dropEchoedLines(parts: ReplyPart[]): void {
  const lines = new Set(parts.filter((p) => p.kind === 'line').map((p) => p.text.trim()));
  if (lines.size === 0) return;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.kind !== 'narration') continue;
    const kept = p.text.split('\n').filter((l) => {
      const m = /^[^「」\s]{1,20}「([\s\S]*)」$/.exec(l.trim());
      return !(m && lines.has(m[1].trim()));
    });
    const text = kept.join('\n').trim();
    if (text) p.text = text;
    else parts.splice(i, 1);
  }
}

// 本文の終わりに紛れ込んだ、対になっていない閉じ括弧を取り除く（JSONの書き損じ）
export function cleanText(s: string): string {
  let t = s.trim();
  const count = (c: string) => [...t].filter((x) => x === c).length;
  while (/[}\]]$/.test(t)) {
    const close = t.endsWith('}') ? '}' : ']';
    const open = close === '}' ? '{' : '[';
    if (count(close) <= count(open)) break;
    t = t.slice(0, -1).trimEnd();
  }
  return t;
}

function stripQuotes(s: string): string {
  const t = s.trim();
  const m = /^[「『"“](.*)[」』"”]$/s.exec(t);
  return m ? m[1].trim() : t;
}

function makeLine(speakerName: string, text: string, resolve: NameResolver): ReplyPart {
  const id = resolve(speakerName);
  return id ? { kind: 'line', speaker: id, text } : { kind: 'line', speakerName, text };
}

// 書きかけのセリフは閉じ括弧がまだないので、開き括弧だけでも外す
function stripOpenQuote(s: string): string {
  return stripQuotes(s).replace(/^[「『"“]/, '');
}

// JSONの値から吹き出しを作る。draft は書きかけの返答（話し手がまだ届いていないセリフは出さない）
function partsFromObject(obj: Record<string, unknown>, format: ReplyFormat, resolve: NameResolver, draft: boolean): ReplyPart[] {
  const parts: ReplyPart[] = [];
  const quote = draft ? stripOpenQuote : stripQuotes;
  if (Array.isArray(obj.parts)) {
    for (const p of obj.parts) {
      if (!p || typeof p !== 'object') continue;
      const rec = p as Record<string, unknown>;
      const text = cleanText(str(rec.text));
      if (!text) continue;
      const speaker = str(rec.speaker);
      if (rec.kind === 'line' && speaker) parts.push(makeLine(speaker, quote(text), resolve));
      else if (!(draft && rec.kind === 'line')) parts.push({ kind: 'narration', text });
    }
  } else {
    // 欄の並び順のまま保存する。本文から推測して分けない
    const spoken = new Set<string>();
    // 書きかけでは、欄の並べ替えで後ろの番号が先に届くことがあるので、届いた番号をすべて見る
    const last = draft
      ? Math.max(-1, ...Object.keys(obj).map((k) => Number(/^(?:narration|speaker|line)_(\d+)$/.exec(k)?.[1] ?? -1)))
      : 99;
    for (let i = 0; i <= last; i++) {
      const hasAny = [`narration_${i}`, `speaker_${i}`, `line_${i}`].some((k) => k in obj);
      if (!hasAny) {
        if (draft) continue;
        break;
      }
      const narration = cleanText(str(obj[`narration_${i}`]));
      if (narration) parts.push({ kind: 'narration', text: narration });
      const speaker = str(obj[`speaker_${i}`]);
      const line = quote(cleanText(str(obj[`line_${i}`])));
      if (!speaker || !line) continue;
      const key = resolve(speaker) ?? speaker;
      // 同じ人の2回目のセリフは捨てる（1人1セリフ）
      if (format === 'perLine' && spoken.has(key)) continue;
      spoken.add(key);
      parts.push(makeLine(speaker, line, resolve));
    }
  }
  dropEchoedLines(parts);
  return parts;
}

// 届いている途中の返答を、読めたところまで吹き出しにする
export function draftReply(raw: string, format: ReplyFormat, resolve: NameResolver): ReplyPart[] {
  const body = partialJsonBody(raw);
  if (body === undefined) return [];
  const data = parsePartialJson(body);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  return partsFromObject(data as Record<string, unknown>, format, resolve, true);
}

export function parseReply(raw: string, format: ReplyFormat, resolve: NameResolver): ParsedReply {
  const data = extractJson(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('返答のJSONの形が違います');
  const obj = data as Record<string, unknown>;
  const parts = partsFromObject(obj, format, resolve, false);
  if (parts.length === 0) throw new Error('返答の本文が空です');

  return {
    parts,
    present: Array.isArray(obj.present) ? obj.present.map(str).filter(Boolean) : undefined,
    location: str(obj.location) || undefined,
    time: str(obj.time) || undefined,
    weather: str(obj.weather) || undefined,
    changes: str(obj.changes) || undefined,
  };
}

// 吹き出しをふつうの文章にする。履歴としてLLMに渡すときと、編集のときに使う
export function partsToText(parts: ReplyPart[], nameOf: (id: string) => string): string {
  return parts
    .map((p) => {
      if (p.kind === 'narration') return p.text;
      const name = p.speaker ? nameOf(p.speaker) : (p.speakerName ?? '');
      return `${name}「${p.text}」`;
    })
    .join('\n');
}

// 編集した文章を吹き出しに戻す。行頭の「名前「…」」をセリフとみなす
export function textToParts(text: string, resolve: NameResolver): ReplyPart[] {
  const parts: ReplyPart[] = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^([^「」\s]{1,20})「([\s\S]*)」$/.exec(line);
    if (m) parts.push(makeLine(m[1], m[2], resolve));
    else parts.push({ kind: 'narration', text: line });
  }
  return parts;
}
