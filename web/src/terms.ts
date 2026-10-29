// 画面に出る名前。仕様書「画面の用語」の表の候補に合わせる。ここを変えれば画面全体が変わる
export const T = {
  plot: 'シナリオ',
  story: '世界観',
  wizard: 'AIと制作', // 動作を表すところでは「する」を足す
  newPlot: 'シナリオを制作',
  manage: 'シナリオ管理',
  character: 'キャラクター',
  player: '主人公',
  playerPosition: '主人公の立場',
  you: 'あなた',
  intro: '導入',
  examples: 'セリフ例',
  lorebook: '設定集',
  preset: '語り手の指示',
  prompts: 'プロンプト',
  style: '文体',
  regenerate: '作り直す',
  infobox: '状況',
  summary: 'あらすじ',
  instruction: '展開の指示',
  novel: '小説モード',
  rp: 'RP',
  userMode: '自分の映り方',
  safety: '挿絵のレーティング',
  rating: '作品のレーティング',
  preview: '送信内容の確認',
  connection: '接続先',
  llm: 'LLM',
  imageGen: '画像生成',
  narratorNote: '調整の指示',
  listing: '紹介',
  illust: '挿絵',
  cover: 'サムネイル',
  site: '投稿サイト',
} as const;

export const USER_MODE_LABELS = { include: '描く', pov: '主観', exclude: '描かない' } as const;
export const SAFETY_LABELS = { safe: '全年齢', nsfw: '成人向け' } as const;
export const RATING_LABELS = { all: '全年齢', r18: 'R-18', r18g: 'R-18G' } as const;
export const MODE_LABELS = { rp: T.rp, novel: T.novel } as const;
