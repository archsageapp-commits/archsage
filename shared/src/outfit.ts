import type { OutfitSlot, OutfitState, Sex, SlotKey } from './types.ts';

export const SLOT_KEYS: SlotKey[] = [
  'headwear',
  'outerwear',
  'top',
  'onepiece',
  'bottom',
  'bra',
  'panties',
  'legwear',
  'footwear',
  'accessories',
];

export const SLOT_LABELS: Record<SlotKey, string> = {
  headwear: '頭',
  outerwear: '上着',
  top: '上',
  onepiece: 'ワンピース',
  bottom: '下',
  bra: 'ブラ',
  panties: 'ショーツ',
  legwear: '脚',
  footwear: '靴',
  accessories: '小物',
};

// 上半身の構図で外す部位
const LOWER_SLOTS: SlotKey[] = ['bottom', 'panties', 'legwear', 'footwear'];
// 下半身を覆う部位。すべて脱がれているか、めくれている・ずれているときに性器が見えている
const GENITAL_COVER_SLOTS: SlotKey[] = ['bottom', 'onepiece', 'panties'];
// 胸を覆う部位。すべて脱がれているか、はだけている・ずらされているときに乳首が見えている
const CHEST_COVER_SLOTS: SlotKey[] = ['outerwear', 'top', 'onepiece', 'bra'];

// 着ていても肌や中が見えている状態を表す語
const EXPOSING_WORDS = [
  'unbuttoned',
  'unzipped',
  'open',
  'opened',
  'lifted',
  'pulled up',
  'pushed up',
  'pushed aside',
  'breasts out',
  'pulled down',
  'pulled aside',
  'pulled off',
  'shifted',
  'shifted aside',
  'displaced',
  'removed',
  'torn',
  'see-through',
  'around ankles',
  'around one leg',
  'hanging',
  'undone',
  'raised',
  'rolled up',
  'flipped',
];

function hasExposingState(state: string): boolean {
  const s = state.toLowerCase();
  return EXPOSING_WORDS.some((w) => s.includes(w));
}

export function slotPresent(slot: OutfitSlot | undefined): slot is OutfitSlot {
  return !!slot && slot.worn && slot.item.trim() !== '';
}

// その部位が下を覆っているか（着ていて、はだけていない）
function covers(slot: OutfitSlot | undefined): boolean {
  return slotPresent(slot) && !hasExposingState(slot.state);
}

export function emptyOutfit(): OutfitState {
  return { slots: {} };
}

export function cloneOutfit(o: OutfitState | undefined): OutfitState {
  return { slots: { ...(o?.slots ?? {}) } };
}

// 変わった部位だけを前の服装に重ねる
export function mergeOutfit(prev: OutfitState | undefined, changes: Partial<Record<SlotKey, Partial<OutfitSlot> | null>> | undefined): OutfitState {
  const next = cloneOutfit(prev);
  if (!changes) return next;
  for (const key of SLOT_KEYS) {
    if (!(key in changes)) continue;
    const c = changes[key];
    const before = next.slots[key];
    if (c === null) {
      delete next.slots[key];
      continue;
    }
    if (!c) continue;
    next.slots[key] = { item: c.item ?? before?.item ?? '', worn: c.worn ?? before?.worn ?? true, state: c.state ?? before?.state ?? '' };
  }
  return next;
}

export function genitalsVisible(outfit: OutfitState | undefined): boolean {
  const slots = outfit?.slots ?? {};
  // 服装がまったく決まっていない人は分からないので描かない
  if (Object.keys(slots).length === 0) return false;
  return GENITAL_COVER_SLOTS.every((k) => !covers(slots[k]));
}

export function genitalTag(sex: Sex): string {
  return sex === 'male' ? 'penis' : 'pussy';
}

// 女性の乳首が見えているか。性器と同じく、書かないと Anima は描かないことが多い
export function nipplesVisible(outfit: OutfitState | undefined): boolean {
  const slots = outfit?.slots ?? {};
  if (Object.keys(slots).length === 0) return false;
  return CHEST_COVER_SLOTS.every((k) => !covers(slots[k]));
}

// 服装から決まる露出（女性は nipples と pussy、男性は penis）。upperBodyOnly では性器を外す
export function exposedParts(outfit: OutfitState | undefined, sex: Sex, opts: { upperBodyOnly?: boolean } = {}): string[] {
  const out: string[] = [];
  if (sex === 'female' && nipplesVisible(outfit)) out.push('nipples');
  if (!opts.upperBodyOnly && genitalsVisible(outfit)) out.push(genitalTag(sex));
  return out;
}

// 下着が上の服で隠れているか
function underwearHidden(key: SlotKey, slots: Partial<Record<SlotKey, OutfitSlot>>): boolean {
  if (key === 'bra') return covers(slots.top) || covers(slots.onepiece);
  if (key === 'panties') return covers(slots.bottom) || covers(slots.onepiece);
  return false;
}

export interface VisibleOptions {
  upperBodyOnly?: boolean;
  noFeet?: boolean; // 太ももまでの構図では靴を入れない
  pov?: boolean; // POVでは顔と頭を描かない
}

// 画像プロンプトに入れる部位
export function visibleSlots(outfit: OutfitState | undefined, opts: VisibleOptions = {}): { key: SlotKey; slot: OutfitSlot }[] {
  const slots = outfit?.slots ?? {};
  const out: { key: SlotKey; slot: OutfitSlot }[] = [];
  for (const key of SLOT_KEYS) {
    const slot = slots[key];
    if (!slotPresent(slot)) continue;
    if (!slot.item.trim()) continue; // 英語がまだない部位は描けない
    if (opts.upperBodyOnly && LOWER_SLOTS.includes(key)) continue;
    if (opts.noFeet && key === 'footwear') continue;
    if (opts.pov && key === 'headwear') continue;
    if (underwearHidden(key, slots)) continue;
    out.push({ key, slot });
  }
  return out;
}

export function describeSlot(slot: OutfitSlot): string {
  const item = slot.item.trim();
  const state = slot.state.trim();
  return state ? `${state} ${item}` : item;
}

// 「wearing X, Y and Z」の英語句
export function describeOutfit(outfit: OutfitState | undefined, opts: VisibleOptions = {}): string {
  const parts = visibleSlots(outfit, opts).map(({ slot }) => describeSlot(slot));
  return joinEnglish(parts);
}

export function joinEnglish(items: string[]): string {
  const xs = items.filter((x) => x.trim() !== '');
  if (xs.length === 0) return '';
  if (xs.length === 1) return xs[0];
  if (xs.length === 2) return `${xs[0]} and ${xs[1]}`;
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}

// 前と後で変わった部位
const slotKey = (s: OutfitSlot | null | undefined) => (s ? JSON.stringify([s.worn, s.item, s.state]) : 'null');

export function diffOutfit(a: OutfitState | undefined, b: OutfitState | undefined): SlotKey[] {
  const sa = a?.slots ?? {};
  const sb = b?.slots ?? {};
  return SLOT_KEYS.filter((k) => slotKey(sa[k]) !== slotKey(sb[k]));
}

