import { USER_ID } from './id.ts';
import { cloneOutfit } from './outfit.ts';
import type { ParsedReply } from './reply.ts';
import type { Intro, Message, OutfitState, Player, Plot, SceneState } from './types.ts';

export function emptyState(): SceneState {
  return { present: [], outfits: {} };
}

// イントロの場面の初期値から始める。服装は各キャラの初期の服装
export function initialState(plot: Plot, intro: Intro | undefined, player: Player): SceneState {
  const outfits: Record<string, OutfitState> = {};
  for (const c of plot.characters) outfits[c.id] = cloneOutfit(intro?.outfits?.[c.id] ?? c.illust.defaultOutfit);
  outfits[USER_ID] = cloneOutfit(intro?.outfits?.[USER_ID] ?? player.defaultOutfit);
  const present = intro?.present?.length ? [...intro.present] : plot.characters.map((c) => c.id);
  return {
    present,
    location: intro?.location ? { ...intro.location } : undefined,
    time: intro?.time,
    weather: intro?.weather,
    outfits,
  };
}

export function cloneState(s: SceneState): SceneState {
  const outfits: Record<string, OutfitState> = {};
  for (const [k, v] of Object.entries(s.outfits)) outfits[k] = cloneOutfit(v);
  return {
    present: [...s.present],
    location: s.location ? { ...s.location } : undefined,
    time: s.time,
    weather: s.weather,
    outfits,
    pose: s.pose ? { position: s.pose.position, contacts: s.pose.contacts.map((c) => ({ who: [...c.who], what: c.what })) } : undefined,
  };
}

// 指定した位置より前で、いちばん新しい状態を探す
export function stateBefore(messages: Message[], index: number): SceneState | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const m = messages[i];
    const s = m.swipes[m.activeSwipe]?.state;
    if (s) return s;
  }
  return undefined;
}

export function latestState(messages: Message[]): SceneState | undefined {
  return stateBefore(messages, messages.length);
}

// 返答のJSONから、その場にいる人、場所の名前、時間帯と天気を更新する
export function applyReplyToState(
  prev: SceneState,
  reply: ParsedReply,
  resolve: (name: string) => string | undefined,
): SceneState {
  const next = cloneState(prev);
  if (reply.present) {
    const ids = reply.present.map(resolve).filter((x): x is string => !!x && x !== USER_ID);
    next.present = [...new Set(ids)];
  }
  if (reply.location) {
    if (reply.location !== prev.location?.name) {
      // 場所が変わったら背景タグは次の挿絵で作り直す
      next.location = { name: reply.location, tags: '' };
    }
  }
  if (reply.time) next.time = reply.time;
  if (reply.weather) next.weather = reply.weather;
  return next;
}
