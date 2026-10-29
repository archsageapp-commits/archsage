import type { StyleSettings } from './types.ts';

export interface StyleOption {
  value: string;
  label: string;
}

// スタイルの選択肢。各選択肢は styleTexts の定型文に変わる
export const STYLE_OPTIONS = {
  replyFormat: [
    { value: 'perLine', label: '1人1セリフ' },
    { value: 'free', label: '自由' },
  ],
  length: [
    { value: 'short', label: '短い' },
    { value: 'medium', label: '普通' },
    { value: 'long', label: '長い' },
  ],
  dialogueRatio: [
    { value: 'dialogue', label: '会話多め' },
    { value: 'balanced', label: '半々' },
    { value: 'narration', label: '地の文多め' },
  ],
  pace: [
    { value: 'slow', label: 'ゆっくり' },
    { value: 'normal', label: '普通' },
    { value: 'fast', label: '速い' },
  ],
  person: [
    { value: 'third', label: '三人称' },
    { value: 'first', label: '一人称' },
  ],
} satisfies Record<keyof StyleSettings, StyleOption[]>;

export const STYLE_LABELS: Record<keyof StyleSettings, string> = {
  replyFormat: '返答の形',
  length: '応答の長さ',
  dialogueRatio: '会話と地の文の割合',
  pace: '進む速さ',
  person: '人称',
};

export const DEFAULT_STYLE: StyleSettings = {
  replyFormat: 'perLine',
  length: 'medium',
  dialogueRatio: 'balanced',
  pace: 'normal',
  person: 'third',
};

// 定型文。設定画面で上書きできる。キーは「欄.値」
export const DEFAULT_STYLE_TEXTS: Record<string, string> = {
  'length.short': '返答は200〜400字で書く。',
  'length.medium': '返答は400〜800字で書く。',
  'length.long': '返答は800〜1500字で書く。',
  'dialogueRatio.dialogue': 'セリフを中心にし、地の文は短くする。',
  'dialogueRatio.balanced': 'セリフと地の文を半々くらいにする。',
  'dialogueRatio.narration': '地の文を中心にし、情景や心情を細かく書く。',
  'pace.slow': '時間を飛ばさず、場面を変えない。1つの出来事をじっくり書く。',
  'pace.normal': '自然な速さで話を進める。',
  'pace.fast': '話をテンポよく進め、必要なら時間を飛ばしたり場面を変えたりする。',
  'person.third': '地の文は三人称で書く。',
  'person.first': '地の文は、その場の中心にいるキャラの一人称で書く。',
};

export function resolveStyle(base: StyleSettings, override?: Partial<StyleSettings>): StyleSettings {
  return { ...DEFAULT_STYLE, ...base, ...(override ?? {}) };
}

// スタイルを定型文の並びにする。1人1セリフのときは長さなどを指定しない
export function styleTextsFor(style: StyleSettings, overrides: Record<string, string> = {}): string[] {
  if (style.replyFormat === 'perLine') return [];
  const keys = [`length.${style.length}`, `dialogueRatio.${style.dialogueRatio}`, `pace.${style.pace}`, `person.${style.person}`];
  return keys.map((k) => overrides[k] ?? DEFAULT_STYLE_TEXTS[k]).filter((t): t is string => !!t);
}
