import { llmPrompt } from './defaults.ts';
import { newId } from './id.ts';
import { normalizeCharacter, normalizePlayer } from './normalize.ts';
import { SLOT_KEYS } from './outfit.ts';
import { extractJson, type JsonSchema } from './reply.ts';
import { renderTemplate } from './template.ts';
import type { LlmMessage } from './chatPrompt.ts';
import type {
  IntroCandidate,
  OutfitState,
  Player,
  Plot,
  PlotCharacter,
  PlotWizard,
  Sex,
  SlotKey,
  StoryCandidate,
  WizardCandidates,
  WizardCandidateStep,
  WizardPerson,
  WizardStepKey,
} from './types.ts';

// 手順の段。シナリオに入っている中身を正にし、どの段もあとから1つずつ作り直せる
export const WIZARD_STEPS: WizardStepKey[] = ['story', 'cast', 'player', 'intro'];
export const WIZARD_CANDIDATE_STEPS: WizardCandidateStep[] = ['story', 'intro'];

// 人を作る対象。キャラは id、新しく足すときは new、主人公は player
export const NEW_PERSON = 'new';
export const PLAYER_TARGET = 'player';
// 試した絵のうち、サムネイルの置き場所
export const COVER_TARGET = 'cover';

// 主人公を「あなた」にするときは、主人公の段を飛ばす
export function wizardSteps(): WizardStepKey[] {
  return WIZARD_STEPS;
}

// 候補は3つまとめて作るので、会話の設定とは別に長めに取る
export const WIZARD_MAX_TOKENS = 8192;

export function emptyWizard(plotId: string): PlotWizard {
  return { plotId, concept: '', steps: {} };
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

// 文字列でも配列でも受け取る
function joinList(v: unknown, sep: string): string {
  return Array.isArray(v) ? v.map(str).filter(Boolean).join(sep) : str(v);
}

function sexOf(v: unknown, fallback: Sex): Sex {
  return v === 'male' || v === 'female' ? v : fallback;
}

const sexJa = (s: Sex) => (s === 'male' ? '男性' : '女性');

function outfitJa(o: OutfitState | undefined): string {
  return SLOT_KEYS.map((k) => o?.slots[k])
    .filter((s) => !!s)
    .map((s) => s!.item)
    .join('、');
}

// 主人公が決まっているか
function playerSet(plot: Plot): Player | undefined {
  const p = plot.players[0];
  return p && (p.description.trim() || p.appearanceText?.trim()) ? p : undefined;
}

export type WizardContext = WizardCandidateStep | 'finish' | { person: string };

// 作る部分のほかに、シナリオに今入っていることを文章にする
export function contextText(plot: Plot, target: WizardContext, opts: { present?: string[] } = {}): string {
  const person = typeof target === 'object' ? target.person : undefined;
  const out: string[] = [];
  if (target !== 'story') {
    if (plot.title) out.push(`題名: ${plot.title}`);
    if (plot.story) out.push(`世界観と状況:\n${plot.story}`);
    if (plot.playerPosition) out.push(`{{user}}の立場: ${plot.playerPosition}`);
  }
  const others = plot.characters.filter((c) => c.id !== person);
  if (others.length) out.push(`${person === NEW_PERSON ? 'すでにいるキャラ' : 'キャラ'}:\n${others.map((c) => `- ${c.name}: ${c.profile}`).join('\n')}`);
  const p = person === PLAYER_TARGET ? undefined : playerSet(plot);
  // 名前を見せると文章に名前を直に書くので、{{user}} としてだけ渡す
  if (p) out.push(`{{user}}（プレイヤー）: ${sexJa(p.sex)}。${p.description}`);
  if (target === 'intro') {
    const ids = opts.present?.length ? opts.present : plot.characters.map((c) => c.id);
    const names = plot.characters.filter((c) => ids.includes(c.id)).map((c) => c.name);
    if (names.length) out.push(`この場面にいるキャラ: ${names.join('、')}（ほかのキャラは場面に出さない）`);
  }
  if (target === 'finish' && plot.intros[0]?.text) out.push(`導入:\n${plot.intros[0].text}`);
  return out.join('\n\n');
}

// 作り直す人。注文があるときは今の中身を見せて、言われたところだけを直してもらう。
// 注文がないときは名前と性別だけにする。中身を見せると、そのまま写して返すモデルがあるため（nemotron で確かめた）
function currentPersonText(plot: Plot, target: string, full: boolean): string {
  if (target === PLAYER_TARGET) {
    const p = plot.players[0];
    if (!p || !(p.description.trim() || p.appearanceText?.trim())) return '';
    // 主人公を作る呼び出しの中だけは、名前を見せても文章に紛れ込まない
    const head = [`名前: ${p.name}`, `性別: ${sexJa(p.sex)}`];
    return (full ? [...head, `説明: ${p.description}`, p.appearanceText && `見た目: ${p.appearanceText}`, outfitJa(p.defaultOutfit) && `服装: ${outfitJa(p.defaultOutfit)}`] : head).filter(Boolean).join('\n');
  }
  const c = plot.characters.find((x) => x.id === target);
  if (!c) return '';
  const head = [`名前: ${c.name}`, `性別: ${sexJa(c.illust.sex)}`];
  return (full ? [...head, `プロフィール: ${c.profile}`, c.illust.appearanceText && `見た目: ${c.illust.appearanceText}`, outfitJa(c.illust.defaultOutfit) && `服装: ${outfitJa(c.illust.defaultOutfit)}`] : head)
    .filter(Boolean)
    .join('\n');
}

function previousText(step: WizardCandidateStep, wizard: PlotWizard): string {
  const list = (wizard.steps[step]?.candidates ?? []) as WizardCandidates[WizardCandidateStep][];
  return list.map((c) => (step === 'story' ? `- ${c.pitch}（${(c as StoryCandidate).title}）` : `- ${c.pitch}`)).join('\n');
}

function messages(task: string, concept: string, decided: string, extra: { previous?: string; current?: string; request?: string }, overrides: Record<string, string>): LlmMessage[] {
  return [
    { role: 'system', content: llmPrompt('wizard.system', overrides) },
    { role: 'user', content: renderTemplate(llmPrompt('wizard.user', overrides), { concept, decided, task, previous: extra.previous, current: extra.current, request: extra.request }) },
  ];
}

export function buildWizardMessages(step: WizardCandidateStep, plot: Plot, wizard: PlotWizard, request: string, overrides: Record<string, string> = {}): LlmMessage[] {
  const decided = contextText(plot, step, { present: wizard.present });
  return messages(llmPrompt(`wizard.${step}`, overrides), wizard.concept, decided, { previous: previousText(step, wizard), request }, overrides);
}

// キャラか主人公を1人作る。target はキャラの id か new か player
export function buildPersonMessages(target: string, plot: Plot, wizard: PlotWizard, request: string, overrides: Record<string, string> = {}): LlmMessage[] {
  const task = llmPrompt(target === PLAYER_TARGET ? 'wizard.player' : 'wizard.character', overrides);
  return messages(task, wizard.concept, contextText(plot, { person: target }), { current: currentPersonText(plot, target, !!request.trim()), request }, overrides);
}

export function buildFinishMessages(kind: 'illust' | 'listing', plot: Plot, wizard: PlotWizard, overrides: Record<string, string> = {}): LlmMessage[] {
  return messages(llmPrompt(`wizard.${kind}`, overrides), wizard.concept, contextText(plot, 'finish'), {}, overrides);
}

// ---- 返答の形 ----

const S = { type: 'string' } as const;
// タグやセリフ例は、文字列にさせると配列を書こうとして崩れるので、配列で受け取る
const LIST = { type: 'array', items: S } as const;

function obj(props: Record<string, unknown>): JsonSchema {
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
}

function candidates(item: JsonSchema): JsonSchema {
  return obj({ candidates: { type: 'array', items: item } });
}

const OUTFIT = { type: 'array', items: obj({ slot: { type: 'string', enum: SLOT_KEYS }, item: S }) };
const SEX = { type: 'string', enum: ['female', 'male'] };

export const WIZARD_SCHEMAS: Record<WizardCandidateStep, JsonSchema> = {
  story: candidates(obj({ pitch: S, title: S, story: S, playerPosition: S })),
  intro: candidates(obj({ pitch: S, text: S, present: { type: 'array', items: S }, location: S, locationTags: LIST, time: S, weather: S })),
};

export const WIZARD_PERSON_SCHEMA: JsonSchema = obj({ name: S, sex: SEX, profile: S, appearanceText: S, outfit: OUTFIT });

export const WIZARD_ILLUST_SCHEMA: JsonSchema = obj({
  people: { type: 'array', items: obj({ name: S, sex: SEX, appearanceText: S, outfit: OUTFIT }) },
});

export const WIZARD_LISTING_SCHEMA: JsonSchema = obj({ tagline: S, intro: S, hashtags: LIST, examples: LIST });

// 候補の欄をそろえる。LLMの返答にも、画面で直して送られてきた候補にも使う
export function normalizeWizardCandidate<K extends WizardCandidateStep>(step: K, v: Record<string, unknown>): WizardCandidates[K] | undefined {
  const pitch = str(v.pitch);
  if (step === 'story') {
    const c: StoryCandidate = { pitch, title: str(v.title), story: str(v.story), playerPosition: str(v.playerPosition) };
    return (c.story ? c : undefined) as WizardCandidates[K] | undefined;
  }
  const c: IntroCandidate = {
    pitch,
    text: str(v.text),
    present: Array.isArray(v.present) ? v.present.map(str).filter(Boolean) : [],
    location: str(v.location),
    // 「:[」のような崩れた値は捨てる。空なら最初の挿絵で埋まる
    locationTags: /[a-z]/i.test(joinList(v.locationTags, ', ')) ? joinList(v.locationTags, ', ') : '',
    time: str(v.time),
    weather: str(v.weather),
  };
  return (c.text ? c : undefined) as WizardCandidates[K] | undefined;
}

export function parseWizardCandidates<K extends WizardCandidateStep>(step: K, raw: string): WizardCandidates[K][] {
  const d = extractJson(raw) as { candidates?: unknown } | unknown[];
  // スキーマなしだと、外側の形を省いて配列だけ返すことがある
  const list = Array.isArray(d) ? d : Array.isArray(d.candidates) ? d.candidates : [];
  const out = list.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object').map((v) => normalizeWizardCandidate(step, v));
  const ok = out.filter((c): c is WizardCandidates[K] => !!c);
  if (!ok.length) throw new Error('候補の形が違います');
  return ok;
}

// 身に着けていない部位を「none」「なし」と書いて返すことがある
const NOTHING = /^(none|nothing|no|n\/a|なし|無し|-)$/i;

function outfitFrom(v: unknown): OutfitState {
  const outfit: OutfitState = { slots: {} };
  for (const o of Array.isArray(v) ? (v as Record<string, unknown>[]) : []) {
    const slot = o?.slot as SlotKey;
    if (!SLOT_KEYS.includes(slot) || !str(o.item) || NOTHING.test(str(o.item))) continue;
    outfit.slots[slot] = { item: str(o.item), worn: true, state: '' };
  }
  return outfit;
}

export function parseWizardPerson(raw: string): WizardPerson {
  const d = extractJson(raw) as Record<string, unknown> | unknown[];
  // スキーマなしだと、配列や {"character":{…}} の形で返すことがある
  const inner = Array.isArray(d) ? d[0] : str(d.name) ? d : Object.values(d).find((v) => v && typeof v === 'object' && !Array.isArray(v) && str((v as Record<string, unknown>).name));
  const v = (inner ?? {}) as Record<string, unknown>;
  const out: WizardPerson = {
    name: str(v.name),
    sex: sexOf(v.sex, 'female'),
    profile: str(v.profile) || str(v.description),
    // 外見の英文がなく、前の形のタグだけ返ってきたときは、タグを英文の代わりにする
    appearanceText: str(v.appearanceText) || joinList(v.appearanceTags, ', '),
    outfit: outfitFrom(v.outfit),
  };
  if (!out.name || !out.profile) throw new Error('人の形が違います');
  // 提供元によっては中身が空のまま形だけ返すことがある。そのときは作り直してもらう
  if (Object.keys(out.outfit.slots).length === 0) throw new Error('見た目の設定が空でした');
  return out;
}

export interface WizardIllust {
  name: string;
  sex: Sex;
  appearanceText: string;
  outfit: OutfitState;
}

export function parseWizardIllust(raw: string): WizardIllust[] {
  const d = extractJson(raw) as { people?: unknown } | unknown[];
  // スキーマなしだと、外側の形を省いて配列だけ返すことがある
  const list = (Array.isArray(d) ? d : Array.isArray(d.people) ? d.people : []) as Record<string, unknown>[];
  const out = list
    .filter((v) => v && typeof v === 'object' && str(v.name))
    .map((v) => ({ name: str(v.name), sex: sexOf(v.sex, 'female'), appearanceText: str(v.appearanceText) || joinList(v.appearanceTags, ', '), outfit: outfitFrom(v.outfit) }));
  if (!out.length) throw new Error('挿絵の設定の形が違います');
  // 提供元によっては中身が空のまま形だけ返すことがある。そのときは作り直してもらう
  if (out.every((p) => Object.keys(p.outfit.slots).length === 0)) throw new Error('挿絵の設定が空でした');
  return out;
}

export interface WizardListing {
  tagline: string;
  intro: string;
  hashtags: string[];
  examples: string;
}

export function parseWizardListing(raw: string): WizardListing {
  const d = extractJson(raw) as Record<string, unknown>;
  const hashtags = Array.isArray(d.hashtags) ? d.hashtags.map((h) => str(h).replace(/^#/, '')).filter(Boolean) : [];
  // 会話の例は1行ずつの配列で返すことがある
  const joined = joinList(d.examples, '\n');
  // セリフの形になっていない崩れた値は入れず、前のセリフ例を残す
  const examples = joined.includes('「') ? joined : '';
  const out = { tagline: str(d.tagline), intro: str(d.intro), hashtags, examples };
  if (!out.tagline && !out.intro) throw new Error('紹介の形が違います');
  return out;
}

// ---- シナリオに入れる ----

// 「陽葵（ひまり）」と「陽葵」のように、読み仮名や空白の違いは同じ人とみなす
function sameName(a: string, b: string): boolean {
  const key = (s: string) => s.replace(/[（(][^）)]*[）)]/g, '').replace(/\s/g, '');
  return key(a) === key(b);
}

const countTagOf = (sex: Sex) => (sex === 'male' ? '1boy' : '1girl');

// 作った1人をシナリオに入れる。作り直すときは id とアイコンをそのまま残すので、遊んだチャットとのつながりは切れない
export function applyWizardPerson(plot: Plot, target: string, person: WizardPerson): { plot: Plot; id: string } {
  const next = structuredClone(plot);
  const illust = { sex: person.sex, countTag: countTagOf(person.sex), appearanceText: person.appearanceText, defaultOutfit: person.outfit };
  if (target === PLAYER_TARGET) {
    const prev = next.players[0];
    const p = normalizePlayer({ ...prev, name: person.name, sex: person.sex, description: person.profile, countTag: illust.countTag, appearanceText: illust.appearanceText, defaultOutfit: person.outfit });
    next.players = [p, ...next.players.slice(1)];
    return { plot: next, id: PLAYER_TARGET };
  }
  const i = next.characters.findIndex((c) => c.id === target);
  if (i < 0) {
    const c = normalizeCharacter({ id: newId(), name: person.name, profile: person.profile, illust });
    next.characters.push(c);
    return { plot: next, id: c.id };
  }
  next.characters[i] = { ...next.characters[i], name: person.name, profile: person.profile, illust: { ...next.characters[i].illust, ...illust } };
  return { plot: next, id: target };
}

// 作り直す前の中身に戻す。アイコンと立ち絵は、そのあと選び直したものを残す
export function restorePerson(plot: Plot, target: string, prev: PlotCharacter | Player): Plot {
  const next = structuredClone(plot);
  if (target === PLAYER_TARGET) {
    const now = next.players[0];
    next.players = [{ ...(prev as Player), fullBody: now?.fullBody }, ...next.players.slice(1)];
  } else {
    next.characters = next.characters.map((c) => (c.id === target ? { ...(prev as PlotCharacter), avatar: c.avatar, fullBody: c.fullBody } : c));
  }
  return next;
}

export function personOf(plot: Plot, target: string): PlotCharacter | Player | undefined {
  return target === PLAYER_TARGET ? plot.players[0] : plot.characters.find((c) => c.id === target);
}

// キャラを外す。導入の場面にいる人からも外す
export function removeWizardCharacter(plot: Plot, id: string): Plot {
  const next = structuredClone(plot);
  next.characters = next.characters.filter((c) => c.id !== id);
  next.intros = next.intros.map((it) => (it.present ? { ...it, present: it.present.filter((x) => x !== id) } : it));
  return next;
}

// 選んだ候補をシナリオに入れる。その段の欄だけを書き換え、ほかの段には触らない
export function applyWizardChoice<K extends WizardCandidateStep>(plot: Plot, step: K, candidate: WizardCandidates[K], opts: { present?: string[]; mode?: 'replace' | 'add' } = {}): Plot {
  const next = structuredClone(plot);
  if (step === 'story') {
    const c = candidate as StoryCandidate;
    next.title = c.title;
    next.story = c.story;
    next.playerPosition = c.playerPosition;
    return next;
  }
  const c = candidate as IntroCandidate;
  // 場面にいる人は、選んでおいたキャラの中だけにする
  const allowed = opts.present?.length ? next.characters.filter((x) => opts.present!.includes(x.id)) : next.characters;
  const present = c.present.map((name) => allowed.find((x) => sameName(x.name, name))?.id).filter((x): x is string => !!x);
  const intro = {
    text: c.text,
    present: present.length ? [...new Set(present)] : allowed.map((x) => x.id),
    location: c.location ? { name: c.location, tags: c.locationTags } : undefined,
    time: c.time || undefined,
    weather: c.weather || undefined,
  };
  const hasFirst = next.intros.length > 0 && !!next.intros[0].text.trim();
  next.intros = opts.mode === 'add' && hasFirst ? [...next.intros, intro] : [intro, ...next.intros.slice(1)];
  return next;
}

// 挿絵の設定がまだない人の id（主人公は player）。仕上げではこの人たちの分だけ作る
export function illustMissing(plot: Plot): string[] {
  const empty = (text: string | undefined, outfit: OutfitState | undefined) => !text?.trim() && !Object.keys(outfit?.slots ?? {}).length;
  const out = plot.characters.filter((c) => empty(c.illust.appearanceText, c.illust.defaultOutfit)).map((c) => c.id);
  const p = plot.players[0];
  if (p && empty(p.appearanceText, p.defaultOutfit)) out.push(PLAYER_TARGET);
  return out;
}

// 紹介と会話の例を入れ、挿絵の設定がまだない人にだけ挿絵の設定を入れる。手で直した人は上書きしない
export function applyWizardFinish(plot: Plot, illust: WizardIllust[], listing: WizardListing | undefined): Plot {
  const missing = illustMissing(plot);
  const next = structuredClone(plot);
  const find = (name: string) => illust.find((x) => sameName(x.name, name));
  for (const c of next.characters) {
    if (!missing.includes(c.id)) continue;
    const il = find(c.name);
    if (!il) continue;
    c.illust = { ...c.illust, sex: il.sex, countTag: countTagOf(il.sex), appearanceText: il.appearanceText, defaultOutfit: il.outfit };
  }
  // プレイヤーの名前は渡していないので、{{user}} の名前で返ってくる
  const p = next.players[0];
  const il = p && missing.includes(PLAYER_TARGET) ? (find(p.name) ?? illust.find((x) => x.name.includes('{{user}}'))) : undefined;
  if (p && il) {
    p.appearanceText = il.appearanceText;
    p.defaultOutfit = il.outfit;
  }
  if (listing) {
    next.listing = { ...next.listing, tagline: listing.tagline, intro: listing.intro, hashtags: listing.hashtags };
    if (listing.examples) next.examples = listing.examples;
  }
  return next;
}

// 選んだ候補を覚える。前の段を選び直しても、後の段は消さない
export function chooseInWizard<K extends WizardCandidateStep>(wizard: PlotWizard, step: K, index: number, candidate: WizardCandidates[K], now = Date.now()): PlotWizard {
  const next = structuredClone(wizard);
  const s = next.steps[step] as { candidates: WizardCandidates[K][]; chosen?: number } | undefined;
  if (!s || index < 0 || index >= s.candidates.length) throw new Error('候補が見つかりません');
  s.candidates[index] = candidate;
  s.chosen = index;
  return markChanged(next, step, now);
}

export function markChanged(wizard: PlotWizard, step: WizardStepKey | 'finish', now = Date.now()): PlotWizard {
  return { ...wizard, changedAt: { ...wizard.changedAt, [step]: now } };
}

// 前の段があとから変わった段。消さずに、見直すとよいと知らせる
const DEPENDS: Record<WizardStepKey | 'finish', (WizardStepKey | 'finish')[]> = {
  story: [],
  cast: ['story'],
  player: ['story'],
  intro: ['story', 'cast', 'player'],
  finish: ['story', 'cast', 'player', 'intro'],
};

export function wizardStale(wizard: PlotWizard): (WizardStepKey | 'finish')[] {
  const at = wizard.changedAt ?? {};
  return (Object.keys(DEPENDS) as (WizardStepKey | 'finish')[]).filter((k) => at[k] !== undefined && DEPENDS[k].some((d) => (at[d] ?? 0) > at[k]!));
}
