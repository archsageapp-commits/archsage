// データモデル。仕様書「データモデル」に合わせる

export type Sex = 'female' | 'male';
// 挿絵のレーティング。成人向けは nsfw と explicit を両方入れる（SAFETY_TAGS）
export type Safety = 'safe' | 'nsfw';
export type UserMode = 'include' | 'pov' | 'exclude';
export type Rating = 'all' | 'r18' | 'r18g';
export type ChatMode = 'rp' | 'novel';
export type ReplyFormat = 'perLine' | 'free';
export type HistoryMode = 'summarize' | 'truncate';

export type SlotKey =
  | 'headwear'
  | 'outerwear'
  | 'top'
  | 'onepiece'
  | 'bottom'
  | 'bra'
  | 'panties'
  | 'legwear'
  | 'footwear'
  | 'accessories';

// item と state は短い英語の名詞句（例 white blouse / unbuttoned）。画面でも画像プロンプトでもこれを使う
export interface OutfitSlot {
  item: string;
  worn: boolean;
  state: string;
}

// 性器が見えているかは服装から機械的に決めるので持たない
export interface OutfitState {
  slots: Partial<Record<SlotKey, OutfitSlot>>;
}

// 体位や姿勢と、続いている接触
export interface ScenePose {
  position: string;
  contacts: { who: string[]; what: string }[];
}

export interface LocationState {
  name: string; // 日本語
  tags: string; // 英語の背景タグ
}

export interface CharacterIllust {
  sex: Sex;
  countTag: string; // 1girl / 1boy / 1other
  appearanceText: string; // 外見の英文。挿絵ではこれを人の説明に使う
  defaultOutfit: OutfitState;
}

export interface PlotCharacter {
  id: string;
  name: string;
  profile: string;
  avatar?: string; // 画像ファイル名
  fullBody?: string; // 立ち絵。服装を確かめるための全身の絵で、書き出しと投稿には入れない
  illust: CharacterIllust;
}

// シナリオの主人公。「あなた」で遊ぶときも、この形にして渡す
export interface Player {
  id: string;
  name: string;
  description: string;
  sex: Sex;
  countTag: string;
  appearanceText?: string;
  defaultOutfit?: OutfitState;
  fullBody?: string; // 立ち絵。書き出しと投稿には入れない
}

export interface Intro {
  text: string;
  present?: string[]; // charId
  location?: LocationState;
  outfits?: Record<string, OutfitState>; // personId → 服装
  time?: string;
  weather?: string;
}

export interface StyleSettings {
  replyFormat: ReplyFormat;
  length: string;
  dialogueRatio: string;
  pace: string;
  person: string;
}

export interface PlotStyle extends StyleSettings {
  styleTags: string; // 画風タグ
  defaultSafety: Safety;
  defaultUserMode: UserMode;
}

export interface PlotListing {
  cover?: string;
  tagline: string;
  hashtags: string[];
  intro: string; // 紹介文
  creatorComment: string;
  rating: Rating;
  sourceTitle: string; // 二次創作の元作品名。空ならオリジナル
}

// 投稿サイトの投稿を指す印。自分の投稿も、取り込んだ元も、この形で持つ
export interface PostRef {
  site: string; // サイトの URL
  postId: string;
  authorId: string;
  authorName: string;
  title: string;
}

export interface Plot {
  id: string;
  title: string;
  story: string;
  narratorNote: string; // 調整の指示。遊んでみて気になった癖を直す
  characters: PlotCharacter[];
  playerPosition: string;
  players: Player[];
  examples: string;
  lorebookIds: string[];
  intros: Intro[];
  style: PlotStyle;
  listing: PlotListing;
  posted?: PostRef; // このシナリオを投稿した先。次の投稿は更新になる
  origin?: PostRef; // どの投稿から来たか。手直しして投稿したとき、元のシナリオとして表示する
  createdAt: number;
  updatedAt: number;
}

// own は前に自分で作ったプレイヤー。今は作れないが、前の会話のために読めるようにしておく
export interface PlayerRef {
  source: 'plot' | 'you' | 'own';
  id: string;
  asYou?: boolean; // シナリオの主人公を、名前だけ「あなた」にして遊ぶ。挿絵では顔を描かない
}

export interface Chat {
  id: string;
  plotId: string;
  title: string;
  introIndex: number;
  player: PlayerRef;
  mode: ChatMode;
  safety: Safety;
  userMode: UserMode;
  autoIllustrate: boolean;
  // false にすると、時間帯や天気を挿絵のプロンプトに入れない（屋内でも窓と外を描きがちになるため）。会話には使う
  illustTime?: boolean;
  illustWeather?: boolean;
  styleOverride?: Partial<StyleSettings>;
  presetId: string;
  pins?: StatePin[]; // 手で直した欄。物語の中で変わるまで、毎回チャットに送る
  createdAt: number;
  updatedAt: number;
}

export interface ReplyPart {
  kind: 'narration' | 'line';
  speaker?: string; // personId。プロットにいない人は speakerName だけ
  speakerName?: string;
  text: string;
}

export type JobStatus = 'queued' | 'prompting' | 'generating' | 'done' | 'error';

export interface ImageRef {
  id: string;
  file?: string;
  status: JobStatus;
  error?: string;
  seed?: number;
  prompt?: string;
  negative?: string;
  progress?: number; // 0〜1
  createdAt: number;
}

// 状態はスワイプごとに保存する。前の状態から引き継いだ値もここに入る
// 主観の挿絵で、見る人のどこが画面に入るか。none は入らない、hands は手だけ、body は胸から下の体
export type ViewerShows = 'none' | 'hands' | 'body';

// 手で直した欄と、そのときの値。服装は部位ごとで、null は着ていない
export interface ScenePin {
  field: 'present' | 'location' | 'time' | 'weather' | 'pose';
  value: unknown;
}
export interface OutfitPin {
  field: 'outfit';
  person: string;
  slot: SlotKey;
  value: OutfitSlot | null;
}
export type StatePin = ScenePin | OutfitPin;

export interface SceneState {
  present: string[];
  location?: LocationState;
  time?: string;
  weather?: string;
  outfits: Record<string, OutfitState>;
  pose?: ScenePose;
}

export interface Swipe {
  text: string;
  parts?: ReplyPart[];
  changes?: string; // 服装や場所の変化の一言
  reasoning?: string;
  instruction?: string; // 利用者の発言に付けた LLMへの指示
  state?: SceneState;
  raw?: string; // 受け取った生の文章
  error?: string;
  stopped?: boolean; // 書いている途中で止めた。書けたところまでを残している
  images: ImageRef[];
  createdAt: number;
}

export interface Message {
  id: string;
  chatId: string;
  role: 'user' | 'assistant';
  swipes: Swipe[];
  activeSwipe: number;
  createdAt: number;
}

export interface Summary {
  id: string;
  chatId: string;
  fromMessageId: string;
  toMessageId: string;
  text: string;
  stale: boolean;
  createdAt: number;
}

export interface LoreEntry {
  id: string;
  keys: string[];
  content: string;
  constant: boolean;
  enabled: boolean;
  comment?: string;
}

// 設定集だけを投稿するときの紹介。シナリオの紹介と同じ欄で、サムネイルはない
export type LorebookListing = Omit<PlotListing, 'cover'>;

export interface Lorebook {
  id: string;
  name: string;
  entries: LoreEntry[];
  global: boolean;
  listing?: LorebookListing;
  posted?: PostRef; // 設定集だけで投稿したときの印。シナリオの中に写したものには付けない
  origin?: PostRef;
}

export interface Preset {
  id: string;
  name: string;
  systemPrompt: string;
  postHistory: string;
}

// シナリオを手順で作る。段ごとに候補を出し、選んだものをシナリオに入れる
export type WizardStepKey = 'story' | 'cast' | 'player' | 'intro';

export interface StoryCandidate {
  pitch: string; // 候補の違いが分かる一言
  title: string;
  story: string;
  playerPosition: string;
}

export interface IntroCandidate {
  pitch: string;
  text: string;
  present: string[]; // キャラの名前
  location: string;
  locationTags: string; // 英語の背景タグ
  time: string;
  weather: string;
}

// 候補を3つ出して選ぶのは筋書きと導入。キャラと主人公は1人ずつ、候補1つで作る
export type WizardCandidateStep = 'story' | 'intro';

export interface WizardCandidates {
  story: StoryCandidate;
  intro: IntroCandidate;
}

export interface WizardStep<K extends WizardCandidateStep = WizardCandidateStep> {
  candidates: WizardCandidates[K][];
  chosen?: number;
}

// キャラか主人公の1人分。挿絵の設定まで1回の返答にまとめる
export interface WizardPerson {
  name: string;
  sex: Sex;
  profile: string; // 主人公では説明
  appearanceText: string;
  outfit: OutfitState;
}

// 試した絵。全身は服装を、バストアップは顔を確かめてアイコンにでき、サムネイルは仕上げで描く
export interface WizardTry {
  id: string;
  kind: 'full' | 'bust' | 'cover';
  file: string;
  createdAt: number;
}

export interface PlotWizard {
  plotId: string;
  concept: string;
  steps: { [K in WizardCandidateStep]?: WizardStep<K> };
  finished?: boolean; // 紹介と会話の例まで作った
  present?: string[]; // 導入の場面に出すキャラの id。ないときは全員
  previous?: Record<string, PlotCharacter | Player>; // AIで作り直す前の中身。キャラは id、主人公は player
  tries?: Record<string, WizardTry[]>; // 試した絵。キャラは id、主人公は player、サムネイルは cover
  coverRequest?: string; // サムネイルをどんな絵にするかの注文
  coverPresent?: string[]; // サムネイルに描くキャラの id。ないときは導入1の場面にいる人
  coverPlayer?: boolean; // サムネイルに主人公を描くか。ないときはシナリオの描き方に従う
  changedAt?: Partial<Record<WizardStepKey | 'finish', number>>; // 段ごとに、AIで最後に変えた時刻
}

export type ConnectionKind = 'openrouter' | 'openai' | 'koboldcpp' | 'ollama' | 'lmstudio';

export interface Connection {
  id: string;
  name: string;
  kind: ConnectionKind;
  baseUrl: string;
  apiKey?: string; // 画面には返さない
  hasApiKey?: boolean; // 画面に返すのはこちら
  structuredOutputs: boolean; // スキーマを指定して形を固定するか
}

export interface ModelRef {
  connectionId: string;
  model: string;
  provider?: string; // OpenRouterで使う提供元（endpointのtag）。空ならおまかせ
  providerOnly?: boolean; // その提供元だけに送る。既定はまず送り、だめならほかへ回す
}

// OpenRouterの提供元の一覧の1行。料金は100万トークンあたりのドル
export interface ProviderOption {
  tag: string;
  name: string;
  quantization?: string;
  inputPrice: number;
  outputPrice: number;
  structuredOutputs: boolean;
  contextLength?: number;
  down: boolean; // OpenRouterが不調と見ている
}

export interface Sampling {
  temperature: number;
  topP: number;
  maxTokens: number;
}

// 画像生成のプリセット。Animaの版（Base、Aesthetic、Turbo）ごとに、モデルと生成の値と品質タグを持つ
export interface ImageProfile {
  id: string;
  name: string;
  model: string; // 空ならワークフローに書いてあるモデルを使う
  steps: number;
  cfg: number;
  sampler: string; // 空ならワークフローのまま
  scheduler: string; // 同上
  qualityTags: string;
  negative: string;
}

export interface Lora {
  name: string;
  strength: number;
}

export interface NodeInput {
  node: string;
  input: string;
}

export interface ComfyNodeMap {
  positive?: NodeInput;
  negative?: NodeInput;
  seed?: NodeInput;
  width?: NodeInput;
  height?: NodeInput;
  model?: NodeInput; // モデルの名前を入れるところ（UNETLoader の unet_name など）
  steps?: NodeInput;
  cfg?: NodeInput;
  sampler?: NodeInput;
  scheduler?: NodeInput;
}

export interface ComfySettings {
  url: string;
  workflow: Record<string, unknown> | null;
  workflowName: string;
  nodeMap: ComfyNodeMap;
  width: number;
  height: number;
  loras: Lora[]; // プリセットによらず、サンプラーの手前に上から順に挟む
}

// 利用者自身。名前と性別だけを持ち、主人公に当てはめて使う
export interface You {
  name: string;
  sex: Sex;
}

// 投稿サイトとのつながり。token はアプリの鍵で、画面には返さない
export interface SiteSettings {
  url: string;
  token?: string;
  user?: { id: string; displayName: string };
  connected?: boolean; // 画面に返すときだけ付ける
}

export interface Settings {
  connections: Connection[];
  chatModel?: ModelRef;
  utilModel?: ModelRef;
  sampling: Sampling;
  stream: boolean; // 返答を書きながら見せる
  you: You;
  contextTokens: number;
  historyMode: HistoryMode;
  loreScanDepth: number;
  imageProfileId: string;
  imageProfiles: ImageProfile[];
  comfy: ComfySettings;
  llmPrompts: Record<string, string>; // 内部プロンプトの上書き。変更したものだけ
  styleTexts: Record<string, string>; // スタイル定型文の上書き。変更したものだけ
  onboarded: boolean;
  site: SiteSettings;
}
