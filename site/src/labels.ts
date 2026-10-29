// 画面の言葉。アプリの web/src/terms.ts と同じ区分の名前にそろえる
export const RATING_LABELS_JA = { all: '全年齢', r18: 'R-18', r18g: 'R-18G' } as const;

export const REPORT_KINDS = {
  rating: 'レーティングが合っていない',
  prohibited: '禁止されている内容（実在の人物、実在し得る児童の性的な内容など）',
  rights: '権利の侵害',
  other: 'その他',
} as const;
