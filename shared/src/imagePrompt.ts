import { describeOutfit, exposedParts, genitalTag, genitalsVisible, joinEnglish, visibleSlots, describeSlot } from './outfit.ts';
import type { ImageProfile, LocationState, OutfitState, Safety, ScenePose, Sex, UserMode, ViewerShows } from './types.ts';

// レーティングごとにプロンプトの先頭に入れるタグ。sensitive は使わない
export const SAFETY_TAGS: Record<Safety, string[]> = { safe: ['safe'], nsfw: ['nsfw', 'explicit'] };

// 前の4段階（safe、sensitive、nsfw、explicit）で保存した値も読む。sensitive は全年齢にする
export function normalizeSafety(v: unknown): Safety {
  return v === 'nsfw' || v === 'explicit' ? 'nsfw' : 'safe';
}

export interface ImagePerson {
  id: string; // personId。プレイヤーは user
  sex: Sex;
  countTag: string;
  appearanceText: string;
  outfit: OutfitState;
  isPlayer: boolean;
  name?: string; // 場面の英文の {名前} を、この人の外見と服装に置き換える
  position?: string; // 例 on the left
  action?: string; // その人だけの表情としぐさ。英文の最後に入れる
}

export interface ImagePromptInput {
  profile: ImageProfile;
  safety: Safety;
  userMode: UserMode;
  styleTags: string;
  framing?: string;
  people: ImagePerson[]; // 描く人だけ
  pose?: ScenePose;
  action?: string;
  location?: LocationState;
  time?: string;
  weather?: string;
  scene?: string;
  viewerShows?: ViewerShows; // 主観のとき、見る人の手か体が画面に入るか
}

export interface ImagePromptOutput {
  positive: string;
  negative: string;
}

const UPPER_BODY_WORDS = ['upper body', 'portrait', 'close-up', 'close up', 'face', 'headshot', 'bust'];

const NO_FEET_WORDS = ['cowboy shot', 'thighs', 'from waist'];

export function isNoFeetFraming(framing: string | undefined): boolean {
  const f = (framing ?? '').toLowerCase();
  return NO_FEET_WORDS.some((w) => f.includes(w));
}

export function isUpperBodyFraming(framing: string | undefined): boolean {
  const f = (framing ?? '').toLowerCase();
  return UPPER_BODY_WORDS.some((w) => f.includes(w));
}

// 人数タグを数えてまとめる（1girl + 1girl → 2girls）
export function aggregateCountTags(tags: string[]): string[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  for (const raw of tags) {
    const m = /^(\d+)\s*(girl|boy|other)s?$/i.exec(raw.trim());
    const kind = m ? m[2].toLowerCase() : raw.trim().toLowerCase() || 'other';
    const n = m ? Number(m[1]) : 1;
    if (!counts.has(kind)) order.push(kind);
    counts.set(kind, (counts.get(kind) ?? 0) + n);
  }
  return order.map((kind) => {
    const n = counts.get(kind) ?? 1;
    if (!['girl', 'boy', 'other'].includes(kind)) return kind;
    if (n >= 6) return `6+${kind}s`;
    return n === 1 ? `1${kind}` : `${n}${kind}s`;
  });
}

// 背景タグから落とす時間帯や天気のタグ
const TIME_WEATHER_TAGS = new Set([
  'day',
  'daytime',
  'night',
  'nighttime',
  'evening',
  'morning',
  'noon',
  'afternoon',
  'sunset',
  'sunrise',
  'dusk',
  'dawn',
  'twilight',
  'midnight',
  'night sky',
  'starry sky',
  'blue sky',
  'cloudy sky',
  'orange sky',
  'sky',
  'sun',
  'moon',
  'full moon',
  'moonlight',
  'sunlight',
  'rain',
  'raining',
  'rainy',
  'snow',
  'snowing',
  'cloudy',
  'overcast',
  'sunny',
  'clear sky',
  'fog',
  'foggy',
  'storm',
  'lightning',
  'dark',
]);

export function stripTimeWeatherTags(tags: string): string {
  return splitTags(tags)
    .filter((t) => !TIME_WEATHER_TAGS.has(t.toLowerCase()))
    .join(', ');
}

// 日本語の時間帯と天気から、光と空の名詞句を作る
export function lightPhrases(time: string | undefined, weather: string | undefined, indoors = false): string[] {
  const out: string[] = [];
  const t = time ?? '';
  const w = weather ?? '';
  if (/夜明け|明け方|早朝/.test(t)) out.push('dawn', 'soft morning light');
  else if (/朝/.test(t)) out.push('morning', 'soft morning light');
  else if (/夕|黄昏|日暮れ/.test(t)) out.push('sunset', 'warm orange light');
  else if (/深夜|真夜中|夜/.test(t)) out.push('night', 'dim lighting');
  else if (/昼|日中|午後|午前/.test(t)) out.push('daytime', 'bright daylight');
  // 屋内では空を描かない。雨と雪だけ窓の外として残す
  if (indoors) {
    if (/雨/.test(w)) out.push('rain outside the window');
    else if (/雪/.test(w)) out.push('snow outside the window');
    return out;
  }
  if (/雷|嵐/.test(w)) out.push('storm', 'dark clouds');
  else if (/雪/.test(w)) out.push('snowing');
  else if (/雨/.test(w)) out.push('rain');
  else if (/霧/.test(w)) out.push('fog');
  else if (/曇/.test(w)) out.push('overcast');
  else if (/晴/.test(w) && !/夜/.test(t)) out.push('clear sky');
  return out;
}

export function splitTags(s: string | undefined): string[] {
  return (s ?? '')
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter((t) => t !== '');
}

function capitalize(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

function endSentence(s: string): string {
  const t = s.trim();
  if (!t) return '';
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

function nakedWord(outfit: OutfitState): boolean {
  // 服装が決まっていて、何も着ていない
  return Object.keys(outfit.slots).length > 0 && visibleSlots(outfit).length === 0;
}

// キャラごとの英文。「位置 → 外見 → 今の服装 → 性器（見えているとき）」
// その人の外見と今の服装を、名詞句で書く（例 a girl with black hair, wearing white shirt and skirt）
// 主観のプレイヤーは「the viewer」とだけ書く。外見や服装を書くと、見る人とは別の人として描かれる
export function personDescription(p: ImagePerson, opts: { upperBodyOnly: boolean; pov: boolean; noFeet?: boolean }): string {
  if (opts.pov && p.isPlayer) return 'the viewer';
  const exposed = exposedParts(p.outfit, p.sex, { upperBodyOnly: opts.upperBodyOnly });
  const outfitText = describeOutfit(p.outfit, { upperBodyOnly: opts.upperBodyOnly, noFeet: opts.noFeet });
  const pieces: string[] = [p.appearanceText.trim()];
  if (outfitText) pieces.push(`wearing ${outfitText}`);
  else if (nakedWord(p.outfit)) pieces.push('completely naked');
  if (exposed.length) pieces.push(`with exposed ${joinEnglish(exposed)}`);
  return pieces.filter(Boolean).join(', ');
}

// 主観では、見る人はカメラで画面に映らない。挿絵用のLLMが選んだ見え方（viewerShows）のときだけ、見る人の手か体を1文で書く。
// Anima は pov のタグを足しても絵がほとんど変わらないので、タグは使わず文だけで書く。
// 手に着けるもの（手袋など）は相手の手に移りやすいので書かない（作業メモ「実験10〜12」）
export function viewerHandsSentence(p: ImagePerson): string {
  const sleeve = viewerUpper(p, false);
  const his = p.sex === 'female' ? 'her' : 'his';
  return sleeve ? `The viewer's own hands come out of ${his} ${sleeve} sleeves at the bottom edge of the frame.` : "The viewer's own hands reach in from the bottom edge of the frame.";
}

// 上着と上の服。both が true なら「上着 over 上の服」、false なら袖になる一番外の服だけ
function viewerUpper(p: ImagePerson, both: boolean): string {
  const slots = visibleSlots(p.outfit, { pov: true });
  const outer = slots.find((v) => v.key === 'outerwear');
  const top = slots.find((v) => v.key === 'top' || v.key === 'onepiece');
  if (!both) return describeSlot((outer ?? top)?.slot ?? { item: '', worn: true, state: '' });
  return [outer, top].filter((v) => !!v).map((v) => describeSlot(v.slot)).join(' over ');
}

// 画面の下に見る人の胸から下が入るときの1文。上の服と下の服と、見えていれば性器を書く。
// こう書くと、見る人を別の人として描かずに、服をそろえて描ける（作業メモ「実験10〜12」）
export function viewerBodySentence(p: ImagePerson): string {
  const slots = visibleSlots(p.outfit, { pov: true });
  const upper = viewerUpper(p, true);
  const bottom = slots.find((v) => v.key === 'bottom');
  const his = p.sex === 'female' ? 'her' : 'his';
  const genitals = genitalsVisible(p.outfit) ? `${his} ${genitalTag(p.sex)} exposed` : '';
  const wear = [upper ? `in ${upper}` : 'naked', bottom ? `with ${describeSlot(bottom.slot)}` : ''].filter(Boolean).join(', ');
  const tail = genitals ? (bottom ? ` and ${genitals}` : `, with ${genitals}`) : '';
  return `At the bottom of the frame is the viewer's own body, ${wear}${tail}.`;
}

// キャラごとの英文。「位置 → 外見 → 今の服装 → 性器（見えているとき）→ その人の動き」
export function personSentence(p: ImagePerson, opts: { upperBodyOnly: boolean; pov: boolean; noFeet?: boolean }): string {
  if (opts.pov && p.isPlayer) return '';
  const desc = personDescription(p, opts);
  const lead = [p.position?.trim(), desc].filter(Boolean).join(', ');
  return endSentence(capitalize([lead, p.action?.trim()].filter(Boolean).join(', ')));
}

// 2回目からの呼び方。同じ性別が2人以上いるときは外見で区別する
function laterName(p: ImagePerson, people: ImagePerson[], pov: boolean): string {
  if (pov && p.isPlayer) return 'the viewer';
  const same = people.filter((x) => x.sex === p.sex && !(pov && x.isPlayer)).length;
  const base = p.sex === 'male' ? 'the boy' : 'the girl';
  if (same <= 1) return base;
  const text = p.appearanceText.trim();
  return /^an? /i.test(text) ? text.replace(/^an? /i, 'the ') : base;
}

// 場面の英文の {名前} を置き換える。最初は外見と服装、2回目からは短い呼び方にする。
// 描く人にいない名前は、括弧だけを外してそのまま残す
export function renderScene(scene: string, people: ImagePerson[], opts: { upperBodyOnly: boolean; pov: boolean; noFeet?: boolean }): { text: string; mentioned: Set<string> } {
  const mentioned = new Set<string>();
  const text = scene.replace(/\{([^{}]+)\}/g, (m: string, raw: string, offset: number, all: string) => {
    const name = raw.trim();
    const p = people.find((x) => x.name === name);
    if (!p) return name;
    if (opts.pov && p.isPlayer) return 'the viewer';
    if (mentioned.has(p.id)) return laterName(p, people, opts.pov);
    mentioned.add(p.id);
    const desc = personDescription(p, opts);
    // 説明のすぐ後ろに文が続くときはカンマで区切り、続く語が服装にかからないようにする
    const next = all.slice(offset + m.length);
    return desc.includes(',') && /^\s+[A-Za-z]/.test(next) ? `${desc},` : desc;
  });
  // 置き換えで文頭が小文字になったところと、句読点の重なりを整える
  const tidy = text
    .replace(/,\s*([.,;!?])/g, '$1')
    .replace(/(^|[.!?]\s+)([a-z])/g, (_m, a: string, b: string) => a + b.toUpperCase())
    .trim();
  return { text: tidy, mentioned };
}

// 自然文を使わないモデル用のタグ
export function buildImagePrompt(input: ImagePromptInput): ImagePromptOutput {
  const { profile, people } = input;
  const upperBodyOnly = isUpperBodyFraming(input.framing);
  const viewer = input.userMode === 'pov' ? people.find((p) => p.isPlayer) : undefined;
  const pov = !!viewer;
  const others = people.filter((p) => p !== viewer);
  const opts = { upperBodyOnly, pov, noFeet: isNoFeetFraming(input.framing) };

  // 品質 → safety → 人数 → モード → 画風 → 構図
  const head: string[] = [...splitTags(profile.qualityTags), ...SAFETY_TAGS[normalizeSafety(input.safety)]];
  // 主観の見る人は画面に映らないので、人数に数えない
  head.push(...(others.length ? aggregateCountTags(others.map((p) => p.countTag)) : ['no humans']));
  head.push(...splitTags(input.styleTags));
  if (input.framing) head.push(...splitTags(input.framing));

  // 体位と接触 → その場限りの動き → 背景。タグに残った {名前} は呼び方に直す
  const tail: string[] = [];
  const named = (s: string) => s.replace(/\{([^{}]+)\}/g, (_m, raw: string) => {
    const p = people.find((x) => x.name === raw.trim());
    return p ? laterName(p, people, pov) : raw.trim();
  });
  if (input.pose?.position) tail.push(...splitTags(named(input.pose.position)));
  for (const c of input.pose?.contacts ?? []) if (c.what.trim()) tail.push(named(c.what.trim()));
  if (input.action) tail.push(...splitTags(named(input.action)));
  if (input.location?.tags) tail.push(...splitTags(stripTimeWeatherTags(input.location.tags)));
  const indoors = splitTags(input.location?.tags).some((t) => t.toLowerCase() === 'indoors');
  tail.push(...lightPhrases(input.time, input.weather, indoors));

  const multi = others.length >= 2;
  // 見る人の手か体は、ほかの人の外見と場面の英文の後ろに置く。前に置くと、見る人の服がほかの人に移る。
  // LLMが見え方を返さなかったときは、場面の英文に手が書いてあれば手だけにする
  const viewerLines = (text: string): string[] => {
    if (!viewer) return [];
    const shows = input.viewerShows ?? (/\bthe viewer's (own )?(hands?|fingers?)\b/i.test(text) ? 'hands' : 'none');
    if (shows === 'body') return [viewerBodySentence(viewer)];
    if (shows === 'hands') return [viewerHandsSentence(viewer)];
    return [];
  };
  const rawScene = input.scene ?? '';
  let sentences: string[];
  if (/\{[^{}]+\}/.test(rawScene)) {
    // 場面の英文が人の名前で書かれているとき: 名前を外見と服装に置き換え、場面に出なかった人だけ人ごとの英文を足す
    const { text, mentioned } = renderScene(rawScene, people, opts);
    const rest = others.filter((p) => !mentioned.has(p.id)).map((p) => personSentence(p, opts));
    sentences = [endSentence(dedupe(head).join(', ')), endSentence(text), ...rest, ...viewerLines(text), endSentence(dedupe(tail).join(', '))];
  } else {
    // 2人以上では場面の英文を先に置く。人ごとの英文が先だと、1人ずつ別のコマに描かれやすい
    const scene = endSentence(rawScene);
    const each = others.map((p) => personSentence(p, opts));
    sentences = [endSentence(dedupe(head).join(', ')), multi ? scene : '', ...each, endSentence(dedupe(tail).join(', ')), multi ? '' : scene, ...viewerLines(scene)];
  }
  const positive = sentences.filter(Boolean).join(' ');

  const negative = dedupe([...splitTags(profile.negative), ...(multi ? ['multiple views', 'split screen'] : [])]).join(', ');

  return { positive, negative };
}

function dedupe(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tags) {
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
