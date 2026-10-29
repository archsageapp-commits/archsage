import { llmPrompt } from './defaults.ts';
import { USER_ID } from './id.ts';
import { pinsText } from './pins.ts';
import { perLineFieldNames, replySchema, partsToText, type JsonSchema, type NameResolver } from './reply.ts';
import { resolveStyle, styleTextsFor } from './style.ts';
import { renderTemplate, type TemplateVars } from './template.ts';
import { estimateMessagesTokens, estimateTokens } from './tokens.ts';
import type {
  Chat,
  LoreEntry,
  Lorebook,
  Message,
  Player,
  Plot,
  Preset,
  ReplyFormat,
  SceneState,
  Settings,
  Summary,
} from './types.ts';

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export type PromptSettings = Pick<
  Settings,
  'contextTokens' | 'historyMode' | 'loreScanDepth' | 'llmPrompts' | 'styleTexts' | 'sampling'
>;

export interface ChatPromptInput {
  plot: Plot;
  chat: Chat;
  player: Player;
  preset: Preset;
  settings: PromptSettings;
  lorebooks: Lorebook[]; // 全チャット共通のものと、プロットに連動するもの
  history: Message[]; // チャットの全メッセージ（イントロを含む）
  summaries: Summary[];
  state: SceneState;
  instruction?: string;
}

export interface ActivatedLore {
  lorebookId: string;
  lorebookName: string;
  entry: LoreEntry;
}

export interface ChatPrompt {
  messages: LlmMessage[];
  schema: JsonSchema;
  format: ReplyFormat;
  speakers: string[];
  activatedLore: ActivatedLore[];
  tokens: { system: number; history: number; total: number; budget: number };
  droppedMessages: number; // 切り捨てた古い発言の数
  needsSummary: boolean;
  summaryCandidates: string[]; // 要約に回すメッセージの id
}

export function personName(plot: Plot, player: Player, id: string): string {
  if (id === USER_ID) return player.name;
  return plot.characters.find((c) => c.id === id)?.name ?? id;
}

export function makeResolver(plot: Plot, player: Player): NameResolver {
  return (name: string) => {
    const n = name.trim();
    if (!n) return undefined;
    if (n === player.name || n === '{{user}}') return USER_ID;
    const exact = plot.characters.find((c) => c.name === n);
    if (exact) return exact.id;
    // 「ひなた（妹）」や姓名の片方にも合わせる
    const partial = plot.characters.find((c) => c.name && (n.includes(c.name) || c.name.includes(n)));
    return partial?.id;
  };
}

export function baseVars(plot: Plot, player: Player): TemplateVars {
  return {
    user: player.name,
    char: plot.characters.map((c) => c.name).join('、'),
  };
}

export function messageText(m: Message, plot: Plot, player: Player): string {
  const swipe = m.swipes[m.activeSwipe] ?? m.swipes[0];
  if (!swipe) return '';
  if (swipe.parts?.length) return partsToText(swipe.parts, (id) => personName(plot, player, id));
  return swipe.text;
}

export function scanLorebooks(lorebooks: Lorebook[], texts: string[]): ActivatedLore[] {
  const haystack = texts.join('\n').toLowerCase();
  const out: ActivatedLore[] = [];
  for (const book of lorebooks) {
    for (const entry of book.entries) {
      if (!entry.enabled || !entry.content.trim()) continue;
      const hit = entry.constant || entry.keys.some((k) => k.trim() && haystack.includes(k.trim().toLowerCase()));
      if (hit) out.push({ lorebookId: book.id, lorebookName: book.name, entry });
    }
  }
  return out;
}

export function speakersFor(plot: Plot, chat: Chat, player: Player, state: SceneState): string[] {
  const present = state.present.length ? state.present : plot.characters.map((c) => c.id);
  const names = present.map((id) => personName(plot, player, id)).filter((n) => n && n !== player.name);
  if (chat.mode === 'novel') names.push(player.name);
  return names;
}

function section(title: string, body: string): string {
  const b = body.trim();
  return b ? `# ${title}\n${b}` : '';
}

function replyInstructions(format: ReplyFormat, speakers: string[], chat: Chat, input: ChatPromptInput, vars: TemplateVars): string {
  const o = input.settings.llmPrompts;
  const common = renderTemplate(llmPrompt('reply.common', o), vars);
  const fields = perLineFieldNames(Math.max(1, speakers.length));
  const main = renderTemplate(llmPrompt(format === 'perLine' ? 'reply.perLine' : 'reply.free', o), {
    ...vars,
    fields: `${fields.slice(0, 3).join(', ')}, …, ${fields[fields.length - 1]}`,
    speakers: speakers.join('、') || 'なし',
    common,
  });
  const mode = renderTemplate(llmPrompt(chat.mode === 'novel' ? 'reply.novel' : 'reply.rp', o), vars);
  return [main, mode].join('\n');
}

export function buildSystemPrompt(input: ChatPromptInput, activated: ActivatedLore[], summaryText: string, speakers: string[]): string {
  const { plot, chat, player, preset, settings } = input;
  const vars = baseVars(plot, player);
  const style = resolveStyle(plot.style, chat.styleOverride);
  const r = (s: string) => renderTemplate(s, vars);

  const chars = plot.characters
    .map((c) => `## ${c.name}\n${r(c.profile)}`)
    .join('\n\n');
  const playerText = [`名前: ${player.name}`, player.description ? r(player.description) : ''].filter(Boolean).join('\n');
  const lore = activated.map((a) => r(a.entry.content)).join('\n\n');

  return [
    r(preset.systemPrompt),
    styleTextsFor(style, settings.styleTexts).join('\n'),
    replyInstructions(style.replyFormat, speakers, chat, input, vars),
    section('物語', r(plot.story)),
    section('キャラ', chars),
    section('プレイヤーの立場', r(plot.playerPosition)),
    section(`プレイヤー（${player.name}）`, playerText),
    section('設定集', lore),
    section('これまでのあらすじ', summaryText),
    section('状況例', r(plot.examples)),
  ]
    .filter((s) => s.trim() !== '')
    .join('\n\n');
}

// 毎回変わる情報。最後の利用者の発言の末尾に付ける
export function buildSystemNote(input: ChatPromptInput): string {
  const { plot, player, state, settings } = input;
  const o = settings.llmPrompts;
  const vars = baseVars(plot, player);
  const lines: string[] = [];
  const presentNames = state.present.map((id) => personName(plot, player, id));
  if (presentNames.length) lines.push(renderTemplate(llmPrompt('note.present', o), { ...vars, present: presentNames.join('、') }));
  if (state.location?.name) lines.push(renderTemplate(llmPrompt('note.location', o), { ...vars, location: state.location.name }));
  if (state.time || state.weather) {
    lines.push(renderTemplate(llmPrompt('note.timeWeather', o), { ...vars, time: state.time ?? '', weather: state.weather ?? '' }));
  }
  // 手で直した欄は、物語の中で変わるまで毎回送る（作業メモ「手で直した服装」）
  const pinned = pinsText(input.chat.pins ?? [], (id) => personName(plot, player, id));
  if (pinned) lines.push(renderTemplate(llmPrompt('note.pinned', o), { ...vars, fix: pinned }));
  if (input.instruction?.trim()) {
    lines.push(renderTemplate(llmPrompt('note.instruction', o), { ...vars, instruction: input.instruction.trim() }));
  }
  if (plot.narratorNote.trim()) lines.push(renderTemplate(plot.narratorNote, vars));
  if (input.preset.postHistory.trim()) lines.push(renderTemplate(input.preset.postHistory, vars));
  if (lines.length === 0) return '';
  return renderTemplate(llmPrompt('note.header', o), { body: lines.join('\n') });
}

export function summarizedBoundary(history: Message[], summaries: Summary[]): number {
  // あらすじに入った最後のメッセージの位置。なければ -1
  let idx = -1;
  for (const s of summaries) {
    const i = history.findIndex((m) => m.id === s.toMessageId);
    if (i > idx) idx = i;
  }
  return idx;
}

const SUMMARY_TRIGGER = 0.8;
const KEEP_RECENT = 6; // 要約しても残す直近の発言

export function buildChatPrompt(input: ChatPromptInput): ChatPrompt {
  const { plot, chat, player, settings, history } = input;
  const style = resolveStyle(plot.style, chat.styleOverride);
  const speakers = speakersFor(plot, chat, player, input.state);

  const activeSummaries = input.summaries.filter((s) => !s.stale);
  const summaryText = activeSummaries.map((s) => s.text).join('\n\n');
  const boundary = settings.historyMode === 'summarize' ? summarizedBoundary(history, activeSummaries) : -1;

  const recent = history.slice(Math.max(0, history.length - settings.loreScanDepth));
  const activated = scanLorebooks(input.lorebooks, recent.map((m) => messageText(m, plot, player)));

  const system = buildSystemPrompt(input, activated, settings.historyMode === 'summarize' ? summaryText : '', speakers);
  const note = buildSystemNote(input);
  const systemTokens = estimateTokens(system) + estimateTokens(note);
  const budget = Math.max(512, settings.contextTokens - systemTokens - settings.sampling.maxTokens);

  // あらすじに入っていない発言を新しい方から積む
  // 空の発言とエラーの返答は送らない
  const pending = history.slice(boundary + 1).filter((m) => !m.swipes[m.activeSwipe]?.error);
  const rendered = pending.map((m) => ({ id: m.id, role: m.role, content: messageText(m, plot, player) })).filter((m) => m.content.trim() !== '');
  const pendingTokens = estimateMessagesTokens(rendered);

  const kept: typeof rendered = [];
  let used = 0;
  for (let i = rendered.length - 1; i >= 0; i--) {
    const t = estimateTokens(rendered[i].content) + 4;
    if (used + t > budget && kept.length > 0) break;
    kept.unshift(rendered[i]);
    used += t;
  }
  const dropped = rendered.length - kept.length;

  let needsSummary = false;
  const summaryCandidates: string[] = [];
  if (settings.historyMode === 'summarize' && pendingTokens > budget * SUMMARY_TRIGGER) {
    needsSummary = true;
    // 古い方から、一定量（使える量の3割ほど）をまとめる
    const target = budget * 0.3;
    let acc = 0;
    for (let i = 0; i < rendered.length - KEEP_RECENT; i++) {
      summaryCandidates.push(rendered[i].id);
      acc += estimateTokens(rendered[i].content);
      if (acc >= target) break;
    }
    if (summaryCandidates.length === 0) needsSummary = false;
  }

  const messages: LlmMessage[] = [{ role: 'system', content: system }];
  for (const m of kept) messages.push({ role: m.role, content: m.content });
  if (note) {
    const last = messages[messages.length - 1];
    if (last.role === 'user') last.content = `${last.content}\n\n${note}`;
    else messages.push({ role: 'user', content: note });
  } else if (messages[messages.length - 1].role !== 'user') {
    messages.push({ role: 'user', content: '（続けてください）' });
  }

  return {
    messages,
    schema: replySchema(style.replyFormat, speakers.length),
    format: style.replyFormat,
    speakers,
    activatedLore: activated,
    tokens: { system: systemTokens, history: used, total: systemTokens + used, budget },
    droppedMessages: dropped,
    needsSummary,
    summaryCandidates,
  };
}
