import { llmPrompt } from './defaults.ts';
import { USER_ID } from './id.ts';
import { buildImagePrompt, type ImagePerson, type ImagePromptOutput } from './imagePrompt.ts';
import { genitalsVisible, mergeOutfit, SLOT_KEYS, cloneOutfit } from './outfit.ts';
import { extractJson, type JsonSchema } from './reply.ts';
import { renderTemplate } from './template.ts';
import type { LlmMessage } from './chatPrompt.ts';
import type {
  Chat,
  ImageProfile,
  OutfitSlot,
  OutfitState,
  Player,
  Plot,
  SceneState,
  ScenePose,
  SlotKey,
  Swipe,
  ViewerShows,
} from './types.ts';

export interface IllustResult {
  outfits: { person: string; slot: SlotKey; item: string; worn: boolean; state: string }[];
  location: { name: string; tags: string };
  pose: { changed: boolean; position: string; contacts: { who: string[]; what: string }[] };
  framing: string;
  action: string;
  scene: string;
  positions: { person: string; position: string; action?: string }[]; // action はその人だけの表情としぐさ
  viewer?: ViewerShows; // 主観のとき、見る人のどこが画面に入るか
}

const S = { type: 'string' };
const VIEWER_SHOWS: ViewerShows[] = ['none', 'hands', 'body'];

export const ILLUST_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    outfits: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          person: S,
          slot: { type: 'string', enum: SLOT_KEYS },
          item: S,
          worn: { type: 'boolean' },
          state: S,
        },
        required: ['person', 'slot', 'item', 'worn', 'state'],
        additionalProperties: false,
      },
    },
    location: {
      type: 'object',
      properties: { name: S, tags: S },
      required: ['name', 'tags'],
      additionalProperties: false,
    },
    pose: {
      type: 'object',
      properties: {
        changed: { type: 'boolean' },
        position: S,
        contacts: {
          type: 'array',
          items: {
            type: 'object',
            properties: { who: { type: 'array', items: S }, what: S },
            required: ['who', 'what'],
            additionalProperties: false,
          },
        },
      },
      required: ['changed', 'position', 'contacts'],
      additionalProperties: false,
    },
    framing: S,
    action: S,
    scene: S,
    positions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { person: S, position: S, action: S },
        required: ['person', 'position', 'action'],
        additionalProperties: false,
      },
    },
    viewer: { type: 'string', enum: VIEWER_SHOWS },
  },
  required: ['outfits', 'location', 'pose', 'framing', 'action', 'scene', 'positions', 'viewer'],
  additionalProperties: false,
};

export interface IllustPerson {
  id: string;
  name: string;
  isPlayer: boolean;
  sex: 'female' | 'male';
  countTag: string;
  appearanceText: string;
  defaultOutfit?: OutfitState;
}

export function illustPeople(plot: Plot, player: Player, state: SceneState): IllustPerson[] {
  const chars = state.present
    .map((id) => plot.characters.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => !!c)
    .map((c) => ({
      id: c.id,
      name: c.name,
      isPlayer: false,
      sex: c.illust.sex,
      countTag: c.illust.countTag,
      appearanceText: c.illust.appearanceText,
      defaultOutfit: c.illust.defaultOutfit,
    }));
  const p: IllustPerson = {
    id: USER_ID,
    name: player.name,
    isPlayer: true,
    sex: player.sex,
    countTag: player.countTag,
    appearanceText: player.appearanceText ?? '',
    defaultOutfit: player.defaultOutfit,
  };
  return [...chars, p];
}

// 描く人: その返答で話したキャラ。誰も話さなければその場にいる人。プレイヤーは映り方に従う
export function drawnPeople(swipe: Swipe, state: SceneState, chat: Chat): string[] {
  const spoke: string[] = [];
  for (const p of swipe.parts ?? []) {
    if (p.kind === 'line' && p.speaker && p.speaker !== USER_ID && state.present.includes(p.speaker) && !spoke.includes(p.speaker)) {
      spoke.push(p.speaker);
    }
  }
  const chars = spoke.length ? spoke : [...state.present];
  if (chat.userMode !== 'exclude') chars.push(USER_ID);
  return chars;
}

function outfitLines(people: IllustPerson[], state: SceneState): string {
  return people
    .map((p) => {
      const o = state.outfits[p.id] ?? p.defaultOutfit ?? { slots: {} };
      const slots = SLOT_KEYS.filter((k) => o.slots[k])
        .map((k) => {
          const s = o.slots[k] as OutfitSlot;
          const worn = s.worn ? '' : '（脱いでいる）';
          return `  ${k}: ${s.item}${worn}${s.state ? ` [${s.state}]` : ''}`;
        })
        .join('\n');
      return `${p.name}\n${slots || '  （未設定）'}`;
    })
    .join('\n');
}

function poseText(pose: ScenePose | undefined, nameOf: (id: string) => string): string {
  if (!pose || (!pose.position && pose.contacts.length === 0)) return '（なし）';
  const contacts = pose.contacts.map((c) => `${c.who.map(nameOf).join('と')}: ${c.what}`).join('\n');
  return [pose.position, contacts].filter(Boolean).join('\n');
}

export interface IllustPromptInput {
  plot: Plot;
  player: Player;
  chat: Chat;
  state: SceneState; // 直前の状態
  drawn: string[];
  history: string[]; // 直近6件の会話（整形済み）
  changes: string[]; // 前回の挿絵から後の変化の一言
  llmPrompts: Record<string, string>;
}

export function buildIllustMessages(input: IllustPromptInput): LlmMessage[] {
  const { plot, player, state } = input;
  const people = illustPeople(plot, player, state);
  const nameOf = (id: string) => people.find((p) => p.id === id)?.name ?? id;
  const peopleText = people
    .map((p) => `- ${p.name}${p.isPlayer ? '（プレイヤー）' : ''}: ${p.sex === 'male' ? '男性' : '女性'}、${p.appearanceText}`)
    .join('\n');
  // 主観で見る人を描くときだけ、見る人を画面に出さない書き方を足す
  const viewer = input.chat.userMode === 'pov' && input.drawn.includes(USER_ID) ? people.find((p) => p.isPlayer) : undefined;
  const user = renderTemplate(llmPrompt('illust.user', input.llmPrompts), {
    people: peopleText,
    outfits: outfitLines(people, state),
    location: state.location?.tags
      ? `${state.location.name}（${state.location.tags}）`
      : `${state.location?.name || '（未設定）'}（背景タグがまだないので、location に name と tags を書く）`,
    pose: poseText(state.pose, nameOf),
    changes: input.changes.filter(Boolean).join('\n') || '（なし）',
    drawn: input.drawn.map(nameOf).join('、') || '（人はいない。背景だけ）',
    pov: viewer ? renderTemplate(llmPrompt('illust.pov', input.llmPrompts), { name: viewer.name }) : '',
    history: input.history.join('\n\n'),
  });
  return [
    { role: 'system', content: renderTemplate(llmPrompt('illust.system', input.llmPrompts), { user: player.name }) },
    { role: 'user', content: user },
  ];
}

export function parseIllustResult(raw: string): IllustResult {
  const d = extractJson(raw) as Partial<IllustResult> & Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const outfits = Array.isArray(d.outfits) ? d.outfits : [];
  return {
    outfits: outfits
      .filter((o) => o && typeof o === 'object' && SLOT_KEYS.includes(o.slot as SlotKey))
      .map((o) => ({ person: str(o.person), slot: o.slot as SlotKey, item: str(o.item), worn: o.worn !== false, state: str(o.state) })),
    location: { name: str(d.location?.name), tags: str(d.location?.tags) },
    pose: {
      changed: !!d.pose?.changed,
      position: str(d.pose?.position),
      contacts: Array.isArray(d.pose?.contacts)
        ? d.pose.contacts.map((c) => ({ who: Array.isArray(c?.who) ? c.who.map(str) : [], what: str(c?.what) }))
        : [],
    },
    framing: str(d.framing),
    action: str(d.action),
    scene: str(d.scene),
    positions: Array.isArray(d.positions) ? d.positions.map((p) => ({ person: str(p?.person), position: str(p?.position), action: str(p?.action) })) : [],
    ...(VIEWER_SHOWS.includes(d.viewer as ViewerShows) ? { viewer: d.viewer as ViewerShows } : {}),
  };
}

// 変わった欄を前の状態に重ねる
export function applyIllustResult(prev: SceneState, result: IllustResult, people: IllustPerson[]): SceneState {
  const idOf = (name: string): string | undefined => {
    const n = name.trim();
    return people.find((p) => p.name === n)?.id ?? people.find((p) => p.name && (n.includes(p.name) || p.name.includes(n)))?.id;
  };
  const outfits: Record<string, OutfitState> = {};
  for (const p of people) outfits[p.id] = cloneOutfit(prev.outfits[p.id] ?? p.defaultOutfit);
  for (const [id, o] of Object.entries(prev.outfits)) if (!outfits[id]) outfits[id] = cloneOutfit(o);

  const grouped = new Map<string, Partial<Record<SlotKey, Partial<OutfitSlot>>>>();
  for (const o of result.outfits) {
    const id = idOf(o.person);
    if (!id) continue;
    const g = grouped.get(id) ?? {};
    g[o.slot] = { item: o.item || undefined, worn: o.worn, state: o.state };
    grouped.set(id, g);
  }
  for (const [id, changes] of grouped) outfits[id] = mergeOutfit(outfits[id], changes);

  let location = prev.location;
  // 場所の名前は返答ごとに返答のJSONから決まる。ここで変えるのは背景タグだけ
  if (result.location.tags) {
    location = { name: prev.location?.name || result.location.name || '', tags: result.location.tags };
  }

  let pose = prev.pose;
  if (result.pose.changed) {
    pose = {
      position: result.pose.position,
      contacts: result.pose.contacts
        .map((c) => ({ who: c.who.map((n) => idOf(n)).filter((x): x is string => !!x), what: c.what }))
        .filter((c) => c.what),
    };
  }

  return { ...prev, outfits, location, pose };
}

export interface IllustBuildInput {
  plot: Plot;
  player: Player;
  chat: Chat;
  state: SceneState; // 重ねた後の状態
  drawn: string[];
  result: Pick<IllustResult, 'framing' | 'action' | 'scene' | 'positions' | 'viewer'>;
  profile: ImageProfile;
}

// LLMが位置を返さなかったときの並び
export function defaultPositions(n: number): string[] {
  if (n <= 1) return ['in the center'];
  if (n === 2) return ['on the left', 'on the right'];
  if (n === 3) return ['on the left', 'in the center', 'on the right'];
  return Array.from({ length: n }, (_, i) => (i === 0 ? 'on the far left' : i === n - 1 ? 'on the far right' : `the ${ordinal(i + 1)} from the left`));
}

function ordinal(n: number): string {
  return n === 2 ? 'second' : n === 3 ? 'third' : n === 4 ? 'fourth' : n === 5 ? 'fifth' : `${n}th`;
}

export function buildIllustImagePrompt(input: IllustBuildInput): ImagePromptOutput {
  const people = illustPeople(input.plot, input.player, input.state);
  const nameToPos = new Map(input.result.positions.filter((p) => p.position).map((p) => [p.person, p.position]));
  const nameToAction = new Map(input.result.positions.filter((p) => p.action).map((p) => [p.person, p.action as string]));
  const found = input.drawn.map((id) => people.find((p) => p.id === id)).filter((p): p is IllustPerson => !!p);
  // POVのプレイヤーは画面の位置を持たない
  const placed = found.filter((p) => !(p.isPlayer && input.chat.userMode === 'pov'));
  const fallback = defaultPositions(placed.length);
  const drawn: ImagePerson[] = found
    .map((p) => ({
      ...p,
      autoPosition: fallback[placed.indexOf(p)],
    }))
    .map((p) => ({
      id: p.id,
      name: p.name,
      sex: p.sex,
      countTag: p.countTag || (p.sex === 'male' ? '1boy' : '1girl'),
      appearanceText: p.appearanceText,
      outfit: input.state.outfits[p.id] ?? p.defaultOutfit ?? { slots: {} },
      isPlayer: p.isPlayer,
      position: placed.length > 1 && p.autoPosition ? (nameToPos.get(p.name) ?? p.autoPosition) : undefined,
      action: nameToAction.get(p.name),
    }));
  return buildImagePrompt({
    profile: input.profile,
    safety: input.chat.safety,
    userMode: input.chat.userMode,
    styleTags: input.plot.style.styleTags,
    framing: input.result.framing,
    people: drawn,
    pose: input.state.pose,
    action: input.result.action,
    location: input.state.location,
    time: input.chat.illustTime === false ? undefined : input.state.time,
    weather: input.chat.illustWeather === false ? undefined : input.state.weather,
    scene: input.result.scene,
    viewerShows: input.result.viewer,
  });
}

// 性器が見えているかの一覧（インフォボックス用）
export function genitalsMap(state: SceneState): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [id, o] of Object.entries(state.outfits)) out[id] = genitalsVisible(o);
  return out;
}
