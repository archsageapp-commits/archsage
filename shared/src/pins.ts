import { describeSlot, diffOutfit, SLOT_LABELS, slotPresent } from './outfit.ts';
import type { SceneState, ScenePin, StatePin } from './types.ts';

// 手で直した状況を覚える。物語の中で変わる（返答のJSONか挿絵用のLLMの追跡で値が変わる）まで、
// 毎回チャットに「利用者が決めた状況」として送る。鍵の代わり（作業メモ「手で直した服装」）
const SCENE_FIELDS: ScenePin['field'][] = ['present', 'location', 'time', 'weather', 'pose'];

function sceneValue(state: SceneState | undefined, field: ScenePin['field']): unknown {
  if (!state) return null;
  if (field === 'present') return [...state.present];
  return state[field] ?? null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function pinKey(p: StatePin): string {
  return p.field === 'outfit' ? `outfit.${p.person}.${p.slot}` : p.field;
}

// 前の状態と比べて、手で直した欄を覚える。同じ欄をまた直したときは新しい値にする
export function pinEdits(pins: StatePin[], prev: SceneState | undefined, next: SceneState): StatePin[] {
  const edits: StatePin[] = [];
  for (const field of SCENE_FIELDS) {
    const value = sceneValue(next, field);
    if (!same(sceneValue(prev, field), value)) edits.push({ field, value: structuredClone(value) });
  }
  for (const [person, o] of Object.entries(next.outfits)) {
    for (const slot of diffOutfit(prev?.outfits[person], o)) edits.push({ field: 'outfit', person, slot, value: o.slots[slot] ? { ...o.slots[slot] } : null });
  }
  const out = [...pins];
  for (const e of edits) {
    const i = out.findIndex((p) => pinKey(p) === pinKey(e));
    if (i >= 0) out[i] = e;
    else out.push(e);
  }
  return out;
}

// 値が変わった欄は、物語の中で変わったものとして外す
export function releasePins(pins: StatePin[], state: SceneState): StatePin[] {
  return pins.filter((p) => (p.field === 'outfit' ? same(state.outfits[p.person]?.slots[p.slot], p.value) : same(sceneValue(state, p.field), p.value)));
}

// チャットに送る一行（例「時間帯は夜、ひなたの上着は着ていない」）
export function pinsText(pins: StatePin[], nameOf: (id: string) => string): string {
  return pins
    .map((p) => {
      if (p.field === 'outfit') return `${nameOf(p.person)}の${SLOT_LABELS[p.slot]}は${p.value && slotPresent(p.value) ? describeSlot(p.value) : '着ていない'}`;
      if (p.field === 'present') {
        const ids = (p.value as string[] | null) ?? [];
        return `その場にいる人は${ids.length ? ids.map(nameOf).join('と') : 'いない'}`;
      }
      if (p.field === 'location') return `場所は${(p.value as { name?: string } | null)?.name || '決まっていない'}`;
      if (p.field === 'time') return `時間帯は${(p.value as string | null) || '決まっていない'}`;
      if (p.field === 'weather') return `天気は${(p.value as string | null) || '決まっていない'}`;
      const pose = p.value as SceneState['pose'] | null;
      const contacts = (pose?.contacts ?? []).map((c) => `${c.who.map(nameOf).join('と')}は${c.what}`);
      return `体位や姿勢は${[pose?.position, ...contacts].filter(Boolean).join('、') || '決まっていない'}`;
    })
    .join('、');
}
