import { emptyPlot } from './defaults.ts';
import { newId } from './id.ts';
import { normalizeSafety } from './imagePrompt.ts';
import { DEFAULT_STYLE } from './style.ts';
import type { Lorebook, LorebookListing, OutfitState, Player, Plot, PlotCharacter, PostRef, You } from './types.ts';

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function outfit(v: unknown): OutfitState {
  const slots = (v as OutfitState | undefined)?.slots;
  const out: OutfitState = { slots: {} };
  if (!slots || typeof slots !== 'object') return out;
  // 前に持っていた日本語の欄（itemJa、stateJa、needsEn）は読み捨てる
  for (const [k, s] of Object.entries(slots)) if (s) out.slots[k as keyof OutfitState['slots']] = { item: str(s.item), worn: s.worn !== false, state: str(s.state) };
  return out;
}

export function normalizeCharacter(v: Partial<PlotCharacter> | undefined): PlotCharacter {
  const c = v ?? {};
  const il: Partial<PlotCharacter['illust']> = c.illust ?? {};
  const sex = il.sex === 'male' ? 'male' : 'female';
  return {
    id: str(c.id) || newId(),
    name: str(c.name),
    profile: str(c.profile),
    avatar: c.avatar,
    ...(c.fullBody ? { fullBody: c.fullBody } : {}),
    illust: {
      sex,
      countTag: str(il.countTag) || (sex === 'male' ? '1boy' : '1girl'),
      appearanceText: appearance(il),
      defaultOutfit: outfit(il.defaultOutfit),
    },
  };
}

export function normalizePlayer(v: Partial<Player> | undefined): Player {
  const p = v ?? {};
  const sex = p.sex === 'female' ? 'female' : 'male';
  return {
    id: str(p.id) || newId(),
    name: str(p.name) || 'あなた',
    description: str(p.description),
    sex,
    countTag: str(p.countTag) || (sex === 'male' ? '1boy' : '1girl'),
    appearanceText: appearance(p),
    defaultOutfit: p.defaultOutfit ? outfit(p.defaultOutfit) : undefined,
    ...(p.fullBody ? { fullBody: p.fullBody } : {}),
  };
}

// 外見は英文だけを持つ。前に持っていた外見タグ（appearanceTags）は、英文がなければ英文の代わりにする
function appearance(v: { appearanceText?: unknown; appearanceTags?: unknown }): string {
  return str(v.appearanceText).trim() || str(v.appearanceTags).trim();
}

// 「あなた」を主人公に当てはめる。見た目は聞かないので、顔を描かない語だけにし、服装は残す
export const FACELESS_TEXT = { male: 'faceless male', female: 'faceless female' } as const;

export function asYou(you: You, base?: Partial<Player>): Player {
  return normalizePlayer({
    id: base?.id,
    name: you.name.trim() || 'あなた',
    sex: you.sex,
    description: '',
    countTag: you.sex === 'male' ? '1boy' : '1girl',
    appearanceText: FACELESS_TEXT[you.sex],
    defaultOutfit: base?.defaultOutfit,
  });
}

// シナリオの主人公を「あなた」として遊ぶ。名前だけ「あなた」にし、外見は顔を描かない語を前に付ける。
// 性別、立場、体つき、服装はシナリオの主人公のまま
export function playAsYou(p: Player, you: You): Player {
  const faceless = FACELESS_TEXT[p.sex];
  const text = (p.appearanceText ?? '').trim();
  return { ...p, name: you.name.trim() || 'あなた', appearanceText: !text ? faceless : text.startsWith('faceless') ? text : `${faceless}, ${text}` };
}

function postRef(v: unknown): PostRef | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const ref = { site: str(r.site), postId: str(r.postId), authorId: str(r.authorId), authorName: str(r.authorName), title: str(r.title) };
  return ref.site && ref.postId ? ref : undefined;
}

// 取り込みと複製で引き継ぐ出どころ。自分の投稿だった印は、元の投稿として移す
export function carriedOrigin(p: Pick<Plot, 'posted' | 'origin'>): PostRef | undefined {
  return p.posted ?? p.origin;
}

export function normalizeLoreListing(v: Partial<LorebookListing> | undefined): LorebookListing {
  const l = v ?? {};
  return {
    tagline: str(l.tagline),
    hashtags: Array.isArray(l.hashtags) ? l.hashtags.filter((t): t is string => typeof t === 'string') : [],
    intro: str(l.intro),
    creatorComment: str(l.creatorComment),
    rating: l.rating === 'r18' || l.rating === 'r18g' ? l.rating : 'all',
    sourceTitle: str(l.sourceTitle),
  };
}

export function normalizeLorebook(v: Partial<Lorebook>, id = str(v.id) || newId()): Lorebook {
  return {
    id,
    name: str(v.name),
    global: !!v.global,
    entries: (Array.isArray(v.entries) ? v.entries : []).map((e) => ({
      id: str(e?.id) || newId(),
      keys: (Array.isArray(e?.keys) ? e.keys : []).filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean),
      content: str(e?.content),
      constant: !!e?.constant,
      enabled: e?.enabled !== false,
      ...(typeof e?.comment === 'string' ? { comment: e.comment } : {}),
    })),
    listing: normalizeLoreListing(v.listing),
    posted: postRef(v.posted),
    origin: postRef(v.origin),
  };
}

// 欠けた欄を既定値で埋める。取り込みや保存のときに通す
export function normalizePlot(v: Partial<Plot>): Plot {
  const base = emptyPlot(str(v.id) || newId(), typeof v.createdAt === 'number' ? v.createdAt : Date.now());
  return {
    ...base,
    title: str(v.title),
    story: str(v.story),
    narratorNote: str(v.narratorNote),
    characters: Array.isArray(v.characters) ? v.characters.map((c) => normalizeCharacter(c)) : [],
    playerPosition: str(v.playerPosition),
    players: Array.isArray(v.players) ? v.players.map((p) => normalizePlayer(p)) : [],
    examples: str(v.examples),
    lorebookIds: Array.isArray(v.lorebookIds) ? v.lorebookIds.filter((x): x is string => typeof x === 'string') : [],
    intros: Array.isArray(v.intros) && v.intros.length ? v.intros.map((i) => ({ ...i, text: str(i?.text) })) : base.intros,
    style: { ...base.style, ...DEFAULT_STYLE, ...(v.style ?? {}), defaultSafety: normalizeSafety(v.style?.defaultSafety) },
    listing: { ...base.listing, ...(v.listing ?? {}), hashtags: Array.isArray(v.listing?.hashtags) ? v.listing.hashtags : [], sourceTitle: str(v.listing?.sourceTitle) },
    posted: postRef(v.posted),
    origin: postRef(v.origin),
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : base.updatedAt,
  };
}
