import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  ANIMA_NODE_MAP,
  asYou,
  COVER_TARGET,
  NEW_PERSON,
  PLAYER_TARGET,
  WIZARD_ILLUST_SCHEMA,
  WIZARD_LISTING_SCHEMA,
  WIZARD_MAX_TOKENS,
  WIZARD_PERSON_SCHEMA,
  WIZARD_SCHEMAS,
  applyWizardChoice,
  applyWizardFinish,
  applyWizardPerson,
  emptyWizard,
  buildFinishMessages,
  buildPersonMessages,
  buildWizardMessages,
  chooseInWizard,
  illustMissing,
  markChanged,
  normalizeWizardCandidate,
  parseWizardCandidates,
  parseWizardIllust,
  parseWizardListing,
  parseWizardPerson,
  personOf,
  removeWizardCharacter,
  restorePerson,
  COVER_SIZE,
  DEFAULT_PRESET,
  ILLUST_SCHEMA,
  USER_ID,
  applyIllustResult,
  applyReplyToState,
  buildChatPrompt,
  buildIllustImagePrompt,
  buildIllustMessages,
  buildImagePrompt,
  drawnPeople,
  illustPeople,
  initialState,
  latestState,
  llmPrompt,
  makeResolver,
  messageText,
  newId,
  normalizePlot,
  parseIllustResult,
  draftReply,
  parseReply,
  partsToText,
  personName,
  normalizeSafety,
  playAsYou,
  releasePins,
  renderTemplate,
  stateBefore,
  textToParts,
  type ActivatedLore,
  type Chat,
  type ComfyNodeMap,
  type Connection,
  type IllustResult,
  type ImageProfile,
  type ImageRef,
  type LlmMessage,
  type Lorebook,
  type Message,
  type Player,
  type JsonSchema,
  type Plot,
  type PlotCharacter,
  type PlotWizard,
  type SceneState,
  type Settings,
  type Summary,
  type Swipe,
  type WizardCandidateStep,
  type WizardStep,
  type WizardTry,
} from '@archsage/shared';
import { callJson, callLlm, LlmError, LlmStopped, type LlmProvider } from './llm.ts';
import { comfyStatus, fillWorkflow, randomSeed, runComfy, validateWorkflow, type ComfyJob } from './comfy.ts';
import { EventHub, SerialQueue } from './events.ts';
import type { Store } from './store.ts';
import type { AppPaths } from './paths.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const FALLBACK_PLAYER: Player = {
  id: 'default',
  name: 'あなた',
  description: '',
  sex: 'male',
  countTag: '1boy',
};

export interface LastRequest {
  kind: 'chat' | 'illust' | 'summary';
  at: number;
  messages: LlmMessage[];
  activatedLore?: ActivatedLore[];
  tokens?: { system: number; history: number; total: number; budget: number };
  raw?: string;
  error?: string;
}

// 書いている途中の返答を画面へ送る間隔
const DRAFT_INTERVAL_MS = 120;

function imageProfileOf(settings: Settings): ImageProfile {
  return settings.imageProfiles.find((p) => p.id === settings.imageProfileId) ?? settings.imageProfiles[0];
}

// プリセットとLoRAのうち、ワークフローに入れる値
function presetJob(settings: Settings): Pick<ComfyJob, 'model' | 'steps' | 'cfg' | 'sampler' | 'scheduler' | 'loras'> {
  const p = imageProfileOf(settings);
  return { model: p.model, steps: p.steps, cfg: p.cfg, sampler: p.sampler, scheduler: p.scheduler, loras: settings.comfy.loras };
}

export interface GenerateOptions {
  text?: string;
  instruction?: string;
  regenerate?: boolean; // 最後の返答に別のスワイプを作る
}

export class Core {
  store: Store;
  paths: AppPaths;
  hub = new EventHub();
  chatQueue = new SerialQueue();
  illustQueue = new SerialQueue();
  comfyQueue = new SerialQueue();
  summaryQueue = new SerialQueue();
  lastRequests = new Map<string, LastRequest[]>();
  generating = new Map<string, AbortController>(); // 返答を書いているチャット

  constructor(store: Store, paths: AppPaths) {
    this.store = store;
    this.paths = paths;
    mkdirSync(join(paths.dataDir, 'images'), { recursive: true });
  }

  // ---- 共通 ----

  plotOf(id: string): Plot {
    const p = this.store.plots.get(id);
    if (!p) throw new HttpError(404, 'シナリオが見つかりません');
    return p;
  }

  chatOf(id: string): Chat {
    const c = this.store.getChat(id);
    if (!c) throw new HttpError(404, 'チャットが見つかりません');
    return c;
  }

  playerOf(chat: Chat, plot: Plot): Player {
    if (chat.player.source === 'plot') {
      const p = plot.players.find((x) => x.id === chat.player.id) ?? FALLBACK_PLAYER;
      return chat.player.asYou ? playAsYou(p, this.store.getSettings().you) : p;
    }
    if (chat.player.source === 'you') return asYou(this.store.getSettings().you, { id: 'you' });
    return this.store.players.get(chat.player.id) ?? FALLBACK_PLAYER;
  }

  lorebooksFor(plot: Plot): Lorebook[] {
    return this.store.lorebooks.list().filter((l) => l.global || plot.lorebookIds.includes(l.id));
  }

  model(settings: Settings, kind: 'chat' | 'util'): { connection: Connection; model: string; provider?: LlmProvider } {
    const ref = kind === 'util' ? (settings.utilModel?.model ? settings.utilModel : settings.chatModel) : settings.chatModel;
    if (!ref?.model) throw new HttpError(400, '会話のモデルが決まっていません。設定の「LLM」で選んでください');
    const connection = settings.connections.find((c) => c.id === ref.connectionId);
    if (!connection) throw new HttpError(400, '接続先が見つかりません。設定の「LLM」を確かめてください');
    const provider = connection.kind === 'openrouter' && ref.provider ? { tag: ref.provider, only: !!ref.providerOnly } : undefined;
    return { connection, model: ref.model, provider };
  }

  remember(chatId: string, r: LastRequest): void {
    const list = this.lastRequests.get(chatId) ?? [];
    list.unshift(r);
    this.lastRequests.set(chatId, list.slice(0, 10));
  }

  workflowFor(settings: Settings): { workflow: Record<string, unknown>; map: ComfyNodeMap } {
    if (settings.comfy.workflow) return { workflow: settings.comfy.workflow, map: settings.comfy.nodeMap };
    const bundled = JSON.parse(readFileSync(join(this.paths.assetsDir, 'workflows', 'anima.json'), 'utf8')) as Record<string, unknown>;
    return { workflow: bundled, map: ANIMA_NODE_MAP };
  }

  async comfyReady(): Promise<boolean> {
    return (await comfyStatus(this.store.getSettings().comfy.url)).ok;
  }

  // ---- チャット ----

  async createChat(input: Partial<Chat> & { plotId: string }): Promise<{ chat: Chat; messages: Message[] }> {
    const plot = this.plotOf(input.plotId);
    const now = Date.now();
    const introIndex = Math.min(Math.max(0, input.introIndex ?? 0), Math.max(0, plot.intros.length - 1));
    const autoIllustrate = input.autoIllustrate ?? (await this.comfyReady());
    const chat: Chat = {
      id: newId(),
      plotId: plot.id,
      title: input.title ?? plot.title,
      introIndex,
      // 主人公のいないシナリオは「あなた」で遊ぶ
      player: input.player ?? (plot.players[0] ? { source: 'plot', id: plot.players[0].id } : { source: 'you', id: 'you' }),
      mode: input.mode ?? 'rp',
      safety: normalizeSafety(input.safety ?? plot.style.defaultSafety),
      userMode: input.userMode ?? plot.style.defaultUserMode,
      autoIllustrate,
      styleOverride: input.styleOverride,
      presetId: input.presetId ?? DEFAULT_PRESET.id,
      createdAt: now,
      updatedAt: now,
    };
    const player = this.playerOf(chat, plot);
    const intro = plot.intros[introIndex];
    const state = initialState(plot, intro, player);
    const text = renderTemplate(intro?.text ?? '', { user: player.name, char: plot.characters.map((c) => c.name).join('、') });
    const resolver = makeResolver(plot, player);
    const first: Message = {
      id: newId(),
      chatId: chat.id,
      role: 'assistant',
      activeSwipe: 0,
      createdAt: now,
      swipes: [{ text, parts: textToParts(text, resolver), state, images: [], createdAt: now }],
    };
    this.store.tx(() => {
      this.store.putChat(chat);
      this.store.addMessage(first);
    });
    if (chat.autoIllustrate && text.trim()) this.illustrate(chat.id, first.id, 0).catch(() => undefined);
    return { chat, messages: [first] };
  }

  previewChat(chatId: string, opts: GenerateOptions): ReturnType<typeof buildChatPrompt> {
    const chat = this.chatOf(chatId);
    const plot = this.plotOf(chat.plotId);
    const player = this.playerOf(chat, plot);
    const messages = this.store.listMessages(chatId);
    const history = [...messages];
    if (opts.text?.trim()) {
      history.push({ id: 'preview', chatId, role: 'user', activeSwipe: 0, createdAt: Date.now(), swipes: [{ text: opts.text, images: [], createdAt: Date.now() }] });
    }
    let target = history.length;
    if (opts.regenerate && history[history.length - 1]?.role === 'assistant') target = history.length - 1;
    const h = history.slice(0, target);
    const state = latestState(h) ?? initialState(plot, plot.intros[chat.introIndex], player);
    return buildChatPrompt({
      plot,
      chat,
      player,
      preset: this.store.presets.get(chat.presetId) ?? DEFAULT_PRESET,
      settings: this.store.getSettings(),
      lorebooks: this.lorebooksFor(plot),
      history: h,
      summaries: this.store.listSummaries(chatId),
      state,
      instruction: opts.instruction ?? lastInstruction(h),
    });
  }

  generate(chatId: string, opts: GenerateOptions): Promise<Message | undefined> {
    if (this.chatQueue.busy(chatId)) throw new HttpError(409, '返答を作っている途中です');
    this.hub.emit({ type: 'busy', chatId, busy: true });
    return this.chatQueue
      .run(chatId, () => this.generateNow(chatId, opts))
      .finally(() => this.hub.emit({ type: 'busy', chatId, busy: false }));
  }

  // 書いている途中の返答を止める
  stopGenerate(chatId: string): boolean {
    const c = this.generating.get(chatId);
    if (!c) return false;
    c.abort();
    return true;
  }

  async generateNow(chatId: string, opts: GenerateOptions): Promise<Message | undefined> {
    const chat = this.chatOf(chatId);
    const plot = this.plotOf(chat.plotId);
    const player = this.playerOf(chat, plot);
    const settings = this.store.getSettings();
    const { connection, model, provider } = this.model(settings, 'chat');
    let messages = this.store.listMessages(chatId);

    if (opts.text?.trim() || (opts.instruction?.trim() && !opts.regenerate && messages[messages.length - 1]?.role !== 'user')) {
      const now = Date.now();
      const um: Message = {
        id: newId(),
        chatId,
        role: 'user',
        activeSwipe: 0,
        createdAt: now,
        swipes: [{ text: opts.text?.trim() ?? '', instruction: opts.instruction?.trim() || undefined, images: [], createdAt: now }],
      };
      this.store.addMessage(um);
      messages = [...messages, um];
      this.hub.emit({ type: 'message', chatId, messageId: um.id });
    }

    let target: Message | undefined;
    if (opts.regenerate && messages[messages.length - 1]?.role === 'assistant' && messages.length > 1) target = messages[messages.length - 1];
    const history = target ? messages.slice(0, -1) : messages;
    const state = latestState(history) ?? initialState(plot, plot.intros[chat.introIndex], player);

    const prompt = buildChatPrompt({
      plot,
      chat,
      player,
      preset: this.store.presets.get(chat.presetId) ?? DEFAULT_PRESET,
      settings,
      lorebooks: this.lorebooksFor(plot),
      history,
      summaries: this.store.listSummaries(chatId),
      state,
      instruction: lastInstruction(history),
    });
    const record: LastRequest = { kind: 'chat', at: Date.now(), messages: prompt.messages, activatedLore: prompt.activatedLore, tokens: prompt.tokens };

    const resolver = makeResolver(plot, player);
    const now = Date.now();
    const controller = new AbortController();
    this.generating.set(chatId, controller);
    // 書いている途中の返答を画面へ送る。送りすぎないよう間を空ける
    let lastDraft = 0;
    const draft = (text: string, reasoning: string) => {
      const t = Date.now();
      if (t - lastDraft < DRAFT_INTERVAL_MS) return;
      lastDraft = t;
      const parts = draftReply(text, prompt.format, resolver);
      this.hub.emit({ type: 'draft', chatId, parts, thinking: parts.length === 0 && (!!reasoning || /<think/i.test(text)) });
    };
    let swipe: Swipe;
    try {
      const req = {
        connection,
        model,
        provider,
        messages: prompt.messages,
        sampling: settings.sampling,
        schema: { name: 'reply', schema: prompt.schema },
        signal: controller.signal,
        onDelta: settings.stream ? draft : undefined,
      };
      let res;
      try {
        res = await callLlm(req);
      } catch (e) {
        // スキーマの指定を受け付けない接続先なら、スキーマなしでやり直す。OpenRouterで決めた提供元が対応していないときは404になる
        if (!(e instanceof LlmError && (e.status === 400 || e.status === 404 || e.status === 422) && connection.structuredOutputs)) throw e;
        this.hub.emit({ type: 'draft', chatId, parts: [], thinking: false });
        res = await callLlm({ ...req, connection: { ...connection, structuredOutputs: false } });
      }
      record.raw = res.text;
      try {
        const parsed = parseReply(res.text, prompt.format, resolver);
        const nextState = applyReplyToState(state, parsed, resolver);
        swipe = {
          text: partsToText(parsed.parts, (id) => personName(plot, player, id)),
          parts: parsed.parts,
          changes: parsed.changes,
          reasoning: res.reasoning,
          state: nextState,
          raw: res.text,
          images: [],
          createdAt: now,
        };
      } catch (e) {
        const hint = res.finishReason === 'length' ? '（返答が上限トークンで切れました。考える過程を出すモデルでは、設定の「返答の上限トークン」を増やしてください）' : '';
        swipe = { text: '', error: `返答のJSONを読めませんでした${hint}: ${(e as Error).message}`, raw: res.text, reasoning: res.reasoning, state, images: [], createdAt: now };
      }
    } catch (e) {
      if (e instanceof LlmStopped) {
        // 止めたときは書けたところまでを残す。場面の状態は前のまま
        record.raw = e.text;
        const parts = draftReply(e.text, prompt.format, resolver);
        if (parts.length === 0) {
          record.error = '止めました（本文が届く前でした）';
          this.remember(chatId, record);
          return undefined;
        }
        swipe = {
          text: partsToText(parts, (id) => personName(plot, player, id)),
          parts,
          reasoning: e.reasoning || undefined,
          state,
          raw: e.text,
          stopped: true,
          images: [],
          createdAt: now,
        };
      } else swipe = { text: '', error: (e as Error).message, state, images: [], createdAt: now };
    } finally {
      this.generating.delete(chatId);
    }
    record.error = swipe.error;
    this.remember(chatId, record);

    let saved: Message;
    if (target) {
      const active = target.swipes[target.activeSwipe];
      // エラーのスワイプは作り直したものと置き換える
      if (active?.error) target.swipes[target.activeSwipe] = swipe;
      else {
        target.swipes.push(swipe);
        target.activeSwipe = target.swipes.length - 1;
      }
      saved = this.store.putMessage(target);
    } else {
      saved = this.store.addMessage({ id: newId(), chatId, role: 'assistant', activeSwipe: 0, createdAt: now, swipes: [swipe] });
    }
    if (!swipe.error) {
      // 返答で変わった欄は、手で直した値から外す
      const fresh = this.chatOf(chatId);
      if (swipe.state && fresh.pins?.length) fresh.pins = releasePins(fresh.pins, swipe.state);
      this.store.putChat(fresh);
    }
    this.hub.emit({ type: 'message', chatId, messageId: saved.id });

    // 止めた返答では、挿絵と要約を自動では作らない
    if (!swipe.error && !swipe.stopped) {
      if (chat.autoIllustrate) {
        this.comfyReady()
          .then((ok) => (ok ? this.illustrate(chatId, saved.id, saved.activeSwipe) : undefined))
          .catch(() => undefined);
      }
      if (prompt.needsSummary) this.summarize(chatId).catch(() => undefined);
    }
    return saved;
  }

  // ---- 挿絵 ----

  updateImage(messageId: string, swipeIndex: number, imageId: string, fn: (img: ImageRef, swipe: Swipe) => void): Message | undefined {
    const m = this.store.getMessage(messageId);
    const swipe = m?.swipes[swipeIndex];
    const img = swipe?.images.find((i) => i.id === imageId);
    if (!m || !swipe || !img) return undefined;
    fn(img, swipe);
    this.store.putMessage(m);
    return m;
  }

  emitImage(chatId: string, messageId: string, swipeIndex: number, img: ImageRef): void {
    this.hub.emit({ type: 'image', chatId, messageId, swipeIndex, imageId: img.id, status: img.status, progress: img.progress });
  }

  async illustrate(chatId: string, messageId: string, swipeIndex?: number, opts: { reseedImageId?: string } = {}): Promise<ImageRef> {
    const m = this.store.getMessage(messageId);
    if (!m || m.chatId !== chatId) throw new HttpError(404, 'メッセージが見つかりません');
    const si = swipeIndex ?? m.activeSwipe;
    const swipe = m.swipes[si];
    if (!swipe) throw new HttpError(404, 'スワイプが見つかりません');
    const img: ImageRef = { id: newId(), status: 'queued', createdAt: Date.now() };
    swipe.images.push(img);
    this.store.putMessage(m);
    this.emitImage(chatId, messageId, si, img);

    void this.illustQueue.run(chatId, async () => {
      try {
        await this.runIllustration(chatId, messageId, si, img.id, opts);
      } catch (e) {
        const msg = (e as Error).message;
        const after = this.updateImage(messageId, si, img.id, (i) => {
          i.status = 'error';
          i.error = msg;
        });
        if (after) this.emitImage(chatId, messageId, si, { ...img, status: 'error', error: msg });
      }
    });
    return img;
  }

  async runIllustration(chatId: string, messageId: string, si: number, imageId: string, opts: { reseedImageId?: string }): Promise<void> {
    const chat = this.chatOf(chatId);
    const plot = this.plotOf(chat.plotId);
    const player = this.playerOf(chat, plot);
    const settings = this.store.getSettings();
    const profile = imageProfileOf(settings);
    const set = (fn: (i: ImageRef, s: Swipe) => void) => {
      const m = this.updateImage(messageId, si, imageId, fn);
      const i = m?.swipes[si]?.images.find((x) => x.id === imageId);
      if (i) this.emitImage(chatId, messageId, si, i);
      return m;
    };

    let positive: string;
    let negative: string;
    const reseedFrom = opts.reseedImageId
      ? this.store.getMessage(messageId)?.swipes[si]?.images.find((i) => i.id === opts.reseedImageId)
      : undefined;
    if (reseedFrom?.prompt) {
      positive = reseedFrom.prompt;
      negative = reseedFrom.negative ?? '';
    } else {
      set((i) => {
        i.status = 'prompting';
      });
      const messages = this.store.listMessages(chatId);
      const idx = messages.findIndex((x) => x.id === messageId);
      const target = messages[idx];
      const swipe = target.swipes[si];
      const state: SceneState = swipe.state ?? stateBefore(messages, idx) ?? initialState(plot, plot.intros[chat.introIndex], player);
      const drawn = drawnPeople(swipe, state, chat);
      const recent = messages.slice(Math.max(0, idx - 5), idx + 1).map((x, k, arr) => {
        const s = k === arr.length - 1 ? swipe : x.swipes[x.activeSwipe];
        const text = s?.parts?.length ? partsToText(s.parts, (id) => personName(plot, player, id)) : (s?.text ?? '');
        return x.role === 'user' ? `${player.name}: ${text}` : text;
      });
      const changes: string[] = [];
      for (let k = idx; k >= 0; k--) {
        const s = k === idx ? swipe : messages[k].swipes[messages[k].activeSwipe];
        if (k !== idx && s?.images.some((i) => i.status === 'done')) break;
        if (s?.changes) changes.unshift(s.changes);
      }
      const llmMessages = buildIllustMessages({ plot, player, chat, state, drawn, history: recent, changes, llmPrompts: settings.llmPrompts });
      const { connection, model, provider } = this.model(settings, 'util');
      const record: LastRequest = { kind: 'illust', at: Date.now(), messages: llmMessages };
      try {
        const { value: result, response } = await callJson(
          { connection, model, provider, messages: llmMessages, sampling: { ...settings.sampling, temperature: 0.4, maxTokens: Math.max(1500, settings.sampling.maxTokens) }, schema: { name: 'illustration', schema: ILLUST_SCHEMA } },
          parseIllustResult,
        );
        record.raw = response.text;
        this.remember(chatId, record);
        const people = illustPeople(plot, player, state);
        const nextState = applyIllustResult(state, result, people);
        const built = buildIllustImagePrompt({ plot, player, chat, state: nextState, drawn, result, profile });
        positive = built.positive;
        negative = built.negative;
        set((_i, s) => {
          s.state = nextState;
        });
        // 最新の返答の追跡で変わった欄は、手で直した値から外す
        if (idx === messages.length - 1) {
          const fresh = this.chatOf(chatId);
          const pins = releasePins(fresh.pins ?? [], nextState);
          if (pins.length !== (fresh.pins ?? []).length) this.store.putChat({ ...fresh, pins });
        }
      } catch (e) {
        record.error = (e as Error).message;
        this.remember(chatId, record);
        throw e;
      }
    }

    const seed = randomSeed();
    set((i) => {
      i.status = 'generating';
      i.prompt = positive;
      i.negative = negative;
      i.seed = seed;
      i.progress = 0;
    });

    const { workflow, map } = this.workflowFor(settings);
    validateWorkflow(workflow);
    const filled = fillWorkflow(workflow, map, { positive, negative, seed, width: settings.comfy.width, height: settings.comfy.height, ...presetJob(settings) });
    let lastEmit = 0;
    const result = await this.comfyQueue.run('comfy', () =>
      runComfy(settings.comfy.url, filled, (p) => {
        const now = Date.now();
        if (now - lastEmit < 300 && p < 1) return;
        lastEmit = now;
        this.hub.emit({ type: 'image', chatId, messageId, swipeIndex: si, imageId, status: 'generating', progress: p });
      }),
    );
    const rel = `chats/${chatId}/${imageId}.${result.ext}`;
    this.saveImage(rel, result.data);
    set((i) => {
      i.status = 'done';
      i.file = rel;
      i.progress = 1;
    });
  }

  saveImage(rel: string, data: Buffer): void {
    if (rel.includes('..') || rel.startsWith('/') || rel.includes('\\')) throw new HttpError(400, '画像の保存先が正しくありません');
    const full = join(this.paths.dataDir, 'images', rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, data);
  }

  removeImages(images: ImageRef[]): void {
    for (const img of images) {
      const full = img.file ? this.imagePath(img.file) : undefined;
      if (full) rmSync(full, { force: true });
    }
  }

  // チャットやシナリオを消したときに、その画像のフォルダも消す
  removeImageDir(rel: 'chats' | 'plots', id: string): void {
    if (!/^[a-z0-9]+$/.test(id)) return;
    rmSync(join(this.paths.dataDir, 'images', rel, id), { recursive: true, force: true });
  }

  // シナリオの画像を別のシナリオのフォルダへ写す。複製したシナリオが元の画像を指さないようにする
  copyPlotImage(rel: string | undefined, plotId: string): string | undefined {
    const from = rel ? this.imagePath(rel) : undefined;
    if (!rel || !from) return undefined;
    const next = `plots/${plotId}/${rel.split('/').pop()}`;
    const to = join(this.paths.dataDir, 'images', next);
    mkdirSync(join(to, '..'), { recursive: true });
    copyFileSync(from, to);
    return next;
  }

  imagePath(rel: string): string | undefined {
    if (rel.includes('..')) return undefined;
    const full = join(this.paths.dataDir, 'images', rel);
    return existsSync(full) ? full : undefined;
  }

  // カバーとバストアップのアバター
  async generatePlotImage(plotId: string, kind: 'cover' | 'avatar', charId?: string, request = ''): Promise<string> {
    const plot = this.plotOf(plotId);
    const settings = this.store.getSettings();
    const profile = imageProfileOf(settings);
    if (kind === 'cover') return this.generateCover(plot, settings, profile, request);
    const c = plot.characters.find((x) => x.id === charId);
    if (!c) throw new HttpError(404, 'キャラが見つかりません');
    return this.renderPersonImage(plot, settings, c, 'bust');
  }

  // 1人だけを描く。バストアップはアイコンに、全身は服装を確かめる立ち絵に使う
  async renderPersonImage(plot: Plot, settings: Settings, person: PlotCharacter | Player, kind: 'full' | 'bust'): Promise<string> {
    const isChar = 'illust' in person;
    const outfit = (isChar ? person.illust.defaultOutfit : person.defaultOutfit) ?? { slots: {} };
    const sex = isChar ? person.illust.sex : person.sex;
    const people = [
      {
        id: person.id,
        sex,
        countTag: (isChar ? person.illust.countTag : person.countTag) || (sex === 'male' ? '1boy' : '1girl'),
        appearanceText: (isChar ? person.illust.appearanceText : person.appearanceText) ?? '',
        outfit,
        isPlayer: false,
      },
    ];
    const full = kind === 'full';
    const { positive, negative } = buildImagePrompt({
      profile: imageProfileOf(settings),
      safety: 'safe',
      userMode: 'exclude',
      styleTags: plot.style.styleTags,
      framing: full ? 'full body, standing, looking at viewer' : 'upper body, portrait, looking at viewer',
      people,
      action: 'smile',
      location: { name: '', tags: 'simple background' },
      scene: full ? 'A full-body standing picture of the character, showing the outfit from head to toe.' : 'A bust-up portrait for a character icon.',
    });
    return full
      ? this.renderPlotImage(plot.id, 'full', settings, positive, `${negative}, cropped, out of frame`, COVER_SIZE)
      : this.renderPlotImage(plot.id, 'avatar', settings, positive, negative, { width: 1024, height: 1024 });
  }

  async renderPlotImage(plotId: string, kind: 'cover' | 'avatar' | 'full', settings: Settings, positive: string, negative: string, size: { width: number; height: number }): Promise<string> {
    const { workflow, map } = this.workflowFor(settings);
    validateWorkflow(workflow);
    const filled = fillWorkflow(workflow, map, { positive, negative, seed: randomSeed(), ...size, ...presetJob(settings) });
    const result = await this.comfyQueue.run('comfy', () => runComfy(settings.comfy.url, filled, () => undefined));
    const rel = `plots/${plotId}/${kind}-${newId(8)}.${result.ext}`;
    this.saveImage(rel, result.data);
    return rel;
  }

  // カバーは最初の導入の場面を1枚の挿絵にする。直立で並べると設定画や分割画面になりやすいので、
  // LLMが使えるときは挿絵と同じ呼び出しで、場面に合った構図と動きを作らせる
  // 描く人は、選ばなければ導入1の場面にいる人。主人公を描くかは、選ばなければシナリオの描き方に従う
  async generateCover(plot: Plot, settings: Settings, profile: ImageProfile, request = '', who: CoverPeople = {}): Promise<string> {
    const player = plot.players[0] ?? FALLBACK_PLAYER;
    const intro = plot.intros[0];
    const state = initialState(plot, intro, player);
    if (who.present) state.present = plot.characters.map((c) => c.id).filter((id) => who.present!.includes(id));
    const userMode = who.player === undefined ? plot.style.defaultUserMode : who.player ? 'include' : 'exclude';
    if (!state.present.length && userMode === 'exclude') throw new HttpError(400, '描く人を1人以上選んでください');
    const chat = { id: 'cover', plotId: plot.id, userMode, safety: 'safe' } as unknown as Chat;
    const drawn = [...state.present, ...(userMode === 'exclude' ? [] : [USER_ID])];
    const introText = renderTemplate(intro?.text ?? '', { user: player.name, char: plot.characters.map((c) => c.name).join('、') });
    const coverNegative = 'character sheet, reference sheet, turnaround, white background, simple background, letterboxed, pillarboxed, black border, border, lineup';

    let result: Pick<IllustResult, 'framing' | 'action' | 'scene' | 'positions'> = {
      framing: 'cowboy shot',
      action: 'talking, interacting with each other, candid moment, dynamic angle',
      scene: 'A candid moment from the story, with everyone interacting together in one continuous scene with a detailed background.',
      positions: [],
    };
    let coverState = state;
    try {
      const { connection, model, provider } = this.model(settings, 'util');
      const msgs = buildIllustMessages({ plot, player, chat, state, drawn, history: [`${plot.story}\n\n${introText}`], changes: [], llmPrompts: settings.llmPrompts });
      msgs[msgs.length - 1].content += `\n\n# この絵について\n${llmPrompt('illust.cover', settings.llmPrompts)}`;
      // 利用者が書いた、どんな絵にしたいか
      if (request.trim()) msgs[msgs.length - 1].content += `\n\n# 利用者からの注文（これを優先する）\n${request.trim()}`;
      const { value } = await callJson(
        { connection, model, provider, messages: msgs, sampling: { ...settings.sampling, temperature: 0.6, maxTokens: Math.max(1500, settings.sampling.maxTokens) }, schema: { name: 'illustration', schema: ILLUST_SCHEMA } },
        parseIllustResult,
      );
      result = value;
      coverState = applyIllustResult(state, value, illustPeople(plot, player, state));
    } catch (e) {
      // 会話のモデルが決まっていないときは、固定の文で作る
      if (!(e instanceof HttpError)) console.error('サムネイルの準備に失敗したため、固定の文で作ります', e);
    }
    const built = buildIllustImagePrompt({ plot, player, chat, state: coverState, drawn, result, profile });
    this.remember(`plot:${plot.id}`, { kind: 'illust', at: Date.now(), messages: [], raw: built.positive });
    return this.renderPlotImage(plot.id, 'cover', settings, built.positive, `${built.negative}, ${coverNegative}`, COVER_SIZE);
  }

  // ---- 履歴の要約 ----

  summarize(chatId: string): Promise<void> {
    return this.summaryQueue.run(chatId, async () => {
      const settings = this.store.getSettings();
      if (settings.historyMode !== 'summarize') return;
      const prompt = this.previewChat(chatId, {});
      if (!prompt.needsSummary || prompt.summaryCandidates.length === 0) return;
      const chat = this.chatOf(chatId);
      const plot = this.plotOf(chat.plotId);
      const player = this.playerOf(chat, plot);
      const messages = this.store.listMessages(chatId);
      const chunk = messages.filter((m) => prompt.summaryCandidates.includes(m.id));
      const text = await this.summaryText(chatId, chunk, plot, player, settings);
      const s: Summary = {
        id: newId(),
        chatId,
        fromMessageId: chunk[0].id,
        toMessageId: chunk[chunk.length - 1].id,
        text,
        stale: false,
        createdAt: Date.now(),
      };
      this.store.putSummary(s);
      await this.mergeSummaries(chatId, settings);
      this.hub.emit({ type: 'summary', chatId });
    });
  }

  async summaryText(chatId: string, chunk: Message[], plot: Plot, player: Player, settings: Settings): Promise<string> {
    const { connection, model, provider } = this.model(settings, 'util');
    const history = chunk
      .map((m) => (m.role === 'user' ? `${player.name}: ${messageText(m, plot, player)}` : messageText(m, plot, player)))
      .join('\n\n');
    const messages: LlmMessage[] = [
      { role: 'system', content: llmPrompt('summary.system', settings.llmPrompts) },
      { role: 'user', content: renderTemplate(llmPrompt('summary.user', settings.llmPrompts), { history, previous: '' }) },
    ];
    const res = await callLlm({ connection, model, provider, messages, sampling: { ...settings.sampling, temperature: 0.3 } });
    this.remember(chatId, { kind: 'summary', at: Date.now(), messages, raw: res.text });
    return res.text.trim();
  }

  // 要約の塊が増えたら、古い塊同士をまとめ直して1つにする
  async mergeSummaries(chatId: string, settings: Settings): Promise<void> {
    const list = this.store.listSummaries(chatId).filter((s) => !s.stale);
    if (list.length < 4) return;
    const old = list.slice(0, -1);
    const { connection, model, provider } = this.model(settings, 'util');
    const res = await callLlm({
      connection,
      model,
      provider,
      messages: [
        { role: 'system', content: llmPrompt('summary.system', settings.llmPrompts) },
        { role: 'user', content: renderTemplate(llmPrompt('summary.merge', settings.llmPrompts), { summaries: old.map((s) => s.text).join('\n\n---\n\n') }) },
      ],
      sampling: { ...settings.sampling, temperature: 0.3 },
    });
    this.store.tx(() => {
      for (const s of old) this.store.deleteSummary(s.id);
      this.store.putSummary({
        id: newId(),
        chatId,
        fromMessageId: old[0].fromMessageId,
        toMessageId: old[old.length - 1].toMessageId,
        text: res.text.trim(),
        stale: false,
        createdAt: old[0].createdAt,
      });
    });
  }

  // 要約済みの発言を編集や削除したら、その塊を古いことにする
  markSummariesStale(chatId: string, messageId: string): void {
    const messages = this.store.listMessages(chatId);
    const idx = messages.findIndex((m) => m.id === messageId);
    if (idx < 0) return;
    for (const s of this.store.listSummaries(chatId)) {
      const from = messages.findIndex((m) => m.id === s.fromMessageId);
      const to = messages.findIndex((m) => m.id === s.toMessageId);
      if (from <= idx && idx <= to) {
        s.stale = true;
        this.store.putSummary(s);
      }
    }
  }

  // 古いと印を付けた塊だけを要約し直す。失敗しても会話は止めない
  refreshStaleSummaries(chatId: string): void {
    if (this.store.getSettings().historyMode !== 'summarize') return;
    for (const s of this.store.listSummaries(chatId).filter((x) => x.stale)) {
      this.resummarize(chatId, s.id).catch(() => undefined);
    }
  }

  resummarize(chatId: string, summaryId: string): Promise<Summary> {
    return this.summaryQueue.run(chatId, async () => {
      const s = this.store.listSummaries(chatId).find((x) => x.id === summaryId);
      if (!s) throw new HttpError(404, '要約が見つかりません');
      const chat = this.chatOf(chatId);
      const plot = this.plotOf(chat.plotId);
      const player = this.playerOf(chat, plot);
      const messages = this.store.listMessages(chatId);
      const from = messages.findIndex((m) => m.id === s.fromMessageId);
      const to = messages.findIndex((m) => m.id === s.toMessageId);
      if (from < 0 || to < from) {
        this.store.deleteSummary(s.id);
        throw new HttpError(409, '要約した範囲の発言がなくなったため、要約を消しました');
      }
      s.text = await this.summaryText(chatId, messages.slice(from, to + 1), plot, player, this.store.getSettings());
      s.stale = false;
      this.store.putSummary(s);
      this.hub.emit({ type: 'summary', chatId });
      return s;
    });
  }

  // メッセージを消す前に、要約の端を内側へずらす
  beforeDeleteMessage(chatId: string, messageId: string): void {
    const messages = this.store.listMessages(chatId);
    const idx = messages.findIndex((m) => m.id === messageId);
    for (const s of this.store.listSummaries(chatId)) {
      const from = messages.findIndex((m) => m.id === s.fromMessageId);
      const to = messages.findIndex((m) => m.id === s.toMessageId);
      if (idx < from || idx > to) continue;
      if (from === to) {
        this.store.deleteSummary(s.id);
        continue;
      }
      if (idx === from) s.fromMessageId = messages[from + 1].id;
      if (idx === to) s.toMessageId = messages[to - 1].id;
      s.stale = true;
      this.store.putSummary(s);
    }
  }

  // ---- シナリオを手順で作る ----

  private async wizardJson<T>(settings: Settings, messages: LlmMessage[], name: string, schema: JsonSchema, parse: (raw: string) => T): Promise<T> {
    const { connection, model, provider } = this.model(settings, 'chat');
    const sampling = { ...settings.sampling, maxTokens: Math.max(settings.sampling.maxTokens, WIZARD_MAX_TOKENS) };
    try {
      const { value } = await callJson({ connection, model, provider, messages, sampling, schema: { name, schema } }, (raw) => {
        try {
          return parse(raw);
        } catch (e) {
          console.error(`手順の返答を読めませんでした（${name}）\n${raw.slice(0, 3000)}`);
          throw new LlmError((e as Error).message);
        }
      });
      return value;
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(502, (e as Error).message);
    }
  }

  async wizardGenerate(plotId: string, step: WizardCandidateStep, request: string, present?: string[]): Promise<PlotWizard> {
    const plot = this.plotOf(plotId);
    const settings = this.store.getSettings();
    let wizard = this.store.getWizard(plotId);
    if (step === 'story' && !wizard.concept.trim()) throw new HttpError(400, 'コンセプトを書いてください');
    if (step === 'intro') {
      if (!plot.characters.length) throw new HttpError(400, 'キャラがまだいません');
      // 場面に出すキャラは、次に開いたときのために覚えておく
      if (present) wizard = this.store.putWizard({ ...wizard, present: present.filter((id) => plot.characters.some((c) => c.id === id)) });
    }
    const messages = buildWizardMessages(step, plot, wizard, request, settings.llmPrompts);
    const candidates = await this.wizardJson(settings, messages, `wizard_${step}`, WIZARD_SCHEMAS[step], (raw) => parseWizardCandidates(step, raw));
    // 待っている間に書き換わっていてもよいよう、読み直してから入れる
    const latest = this.store.getWizard(plotId);
    (latest.steps as Record<WizardCandidateStep, WizardStep>)[step] = { candidates };
    return this.store.putWizard(latest);
  }

  wizardChoose(plotId: string, step: WizardCandidateStep, index: number, candidate: Record<string, unknown>, mode: 'replace' | 'add' = 'replace'): { plot: Plot; wizard: PlotWizard } {
    const c = normalizeWizardCandidate(step, candidate);
    if (!c) throw new HttpError(400, '候補の中身が空です');
    let wizard: PlotWizard;
    try {
      wizard = chooseInWizard(this.store.getWizard(plotId), step, index, c);
    } catch (e) {
      throw new HttpError(404, (e as Error).message);
    }
    const plot = normalizePlot({ ...applyWizardChoice(this.plotOf(plotId), step, c, { present: wizard.present, mode }), updatedAt: Date.now() });
    this.store.tx(() => {
      this.store.plots.put(plot);
      this.store.putWizard(wizard);
    });
    return { plot, wizard };
  }

  private personOrThrow(plot: Plot, target: string): PlotCharacter | Player {
    const p = personOf(plot, target);
    if (!p) throw new HttpError(404, target === PLAYER_TARGET ? '主人公がまだいません' : 'キャラが見つかりません');
    return p;
  }

  // キャラか主人公を1人作り、そのままシナリオに入れる。target はキャラの id か new か player
  async wizardPerson(plotId: string, target: string, request: string): Promise<{ plot: Plot; wizard: PlotWizard; id: string }> {
    const plot = this.plotOf(plotId);
    if (target !== NEW_PERSON && target !== PLAYER_TARGET) this.personOrThrow(plot, target);
    const settings = this.store.getSettings();
    const messages = buildPersonMessages(target, plot, this.store.getWizard(plotId), request, settings.llmPrompts);
    const person = await this.wizardJson(settings, messages, target === PLAYER_TARGET ? 'wizard_player' : 'wizard_character', WIZARD_PERSON_SCHEMA, parseWizardPerson);
    // 待っている間に書き換わっていてもよいよう、読み直してから入れる
    const latest = this.plotOf(plotId);
    const prev = target === NEW_PERSON ? undefined : target === PLAYER_TARGET ? latest.players[0] : this.personOrThrow(latest, target);
    let wizard = this.store.getWizard(plotId);
    const { plot: applied, id } = applyWizardPerson(latest, target, person);
    const next = normalizePlot({ ...applied, updatedAt: Date.now() });
    // 作り直す前の中身を1つだけ残し、元に戻せるようにする
    const hadContent = prev && (target !== PLAYER_TARGET || (prev as Player).description.trim() || (prev as Player).appearanceText?.trim());
    if (hadContent) wizard = { ...wizard, previous: { ...wizard.previous, [id]: prev } };
    wizard = markChanged(wizard, target === PLAYER_TARGET ? 'player' : 'cast');
    this.store.tx(() => {
      this.store.plots.put(next);
      this.store.putWizard(wizard);
    });
    return { plot: next, wizard, id };
  }

  wizardUndo(plotId: string, target: string): { plot: Plot; wizard: PlotWizard } {
    const wizard = this.store.getWizard(plotId);
    const prev = wizard.previous?.[target];
    if (!prev) throw new HttpError(404, '戻せる中身がありません');
    const plot = this.plotOf(plotId);
    this.personOrThrow(plot, target);
    const next = normalizePlot({ ...restorePerson(plot, target, prev), updatedAt: Date.now() });
    const { [target]: _, ...rest } = wizard.previous ?? {};
    const w = markChanged({ ...wizard, previous: rest }, target === PLAYER_TARGET ? 'player' : 'cast');
    this.store.tx(() => {
      this.store.plots.put(next);
      this.store.putWizard(w);
    });
    return { plot: next, wizard: w };
  }

  // このシナリオの画像なら消す
  private dropPlotImage(plotId: string, rel: string | undefined): void {
    if (rel && rel.startsWith(`plots/${plotId}/`)) this.removeImages([{ id: '', status: 'done', createdAt: 0, file: rel }]);
  }

  wizardRemove(plotId: string, charId: string): { plot: Plot; wizard: PlotWizard } {
    const plot = this.plotOf(plotId);
    const c = this.personOrThrow(plot, charId) as PlotCharacter;
    const next = normalizePlot({ ...removeWizardCharacter(plot, charId), updatedAt: Date.now() });
    const wizard = this.store.getWizard(plotId);
    const { [charId]: _p, ...previous } = wizard.previous ?? {};
    const { [charId]: tried = [], ...tries } = wizard.tries ?? {};
    const w = markChanged({ ...wizard, previous, tries, present: wizard.present?.filter((x) => x !== charId) }, 'cast');
    this.store.tx(() => {
      this.store.plots.put(next);
      this.store.putWizard(w);
    });
    for (const rel of new Set([c.avatar, c.fullBody, ...tried.map((t) => t.file)])) this.dropPlotImage(plotId, rel);
    return { plot: next, wizard: w };
  }

  // 見た目を試す。全身は立ち絵としてその人に入れ、バストアップはアイコンの候補として並べる
  async wizardTry(plotId: string, target: string, kind: 'full' | 'bust'): Promise<{ plot: Plot; wizard: PlotWizard }> {
    const plot = this.plotOf(plotId);
    const settings = this.store.getSettings();
    const rel = await this.renderPersonImage(plot, settings, this.personOrThrow(plot, target), kind);
    const latest = this.plotOf(plotId);
    const person = personOf(latest, target);
    if (!person) {
      this.dropPlotImage(plotId, rel);
      throw new HttpError(404, 'この人は外されました');
    }
    if (kind === 'full') person.fullBody = rel;
    // アイコンがまだなければ、描いたバストアップをそのままアイコンにする
    if (kind === 'bust' && 'illust' in person && !person.avatar) person.avatar = rel;
    const avatar = 'avatar' in person ? person.avatar : undefined;
    return this.keepTry(latest, target, kind, rel, [avatar, person.fullBody]);
  }

  // 試した絵を並べて残す。古い絵は、使っている絵でなければ消す
  private keepTry(plot: Plot, target: string, kind: WizardTry['kind'], rel: string, used: (string | undefined)[]): { plot: Plot; wizard: PlotWizard } {
    const wizard = this.store.getWizard(plot.id);
    const list = [...(wizard.tries?.[target] ?? []), { id: newId(8), kind, file: rel, createdAt: Date.now() }];
    for (const t of list.slice(0, -WIZARD_TRY_KEEP)) if (!used.includes(t.file)) this.dropPlotImage(plot.id, t.file);
    const w = { ...wizard, tries: { ...wizard.tries, [target]: list.slice(-WIZARD_TRY_KEEP) } };
    const next = normalizePlot({ ...plot, updatedAt: Date.now() });
    this.store.tx(() => {
      this.store.plots.put(next);
      this.store.putWizard(w);
    });
    return { plot: next, wizard: w };
  }

  // サムネイルを描く。注文は自由に書けて、導入の場面の絵に添える。まだサムネイルがなければ、そのまま使う
  async wizardCover(plotId: string, request: string, who: CoverPeople = {}): Promise<{ plot: Plot; wizard: PlotWizard }> {
    const plot = this.plotOf(plotId);
    if (!plot.characters.length) throw new HttpError(400, 'キャラがまだいません');
    // 次に開いたときのために、注文と描く人を覚えておく
    this.store.putWizard({ ...this.store.getWizard(plotId), coverRequest: request, coverPresent: who.present, coverPlayer: who.player });
    const settings = this.store.getSettings();
    const rel = await this.generateCover(plot, settings, imageProfileOf(settings), request, who);
    const latest = this.plotOf(plotId);
    if (!latest.listing.cover) latest.listing.cover = rel;
    return this.keepTry(latest, COVER_TARGET, 'cover', rel, [latest.listing.cover]);
  }

  // 試したサムネイルを使う
  wizardUseCover(plotId: string, file: string): Plot {
    const plot = this.plotOf(plotId);
    const tried = this.store.getWizard(plotId).tries?.[COVER_TARGET] ?? [];
    if (!tried.some((t) => t.file === file)) throw new HttpError(404, '試した絵が見つかりません');
    const old = plot.listing.cover;
    if (old && old !== file && !tried.some((t) => t.file === old)) this.dropPlotImage(plotId, old);
    plot.listing.cover = file;
    return this.store.plots.put(normalizePlot({ ...plot, updatedAt: Date.now() }));
  }

  // 試したバストアップをアイコンにする
  wizardIcon(plotId: string, charId: string, file: string): Plot {
    const plot = this.plotOf(plotId);
    const c = this.personOrThrow(plot, charId) as PlotCharacter;
    const tried = this.store.getWizard(plotId).tries?.[charId] ?? [];
    if (!tried.some((t) => t.kind === 'bust' && t.file === file)) throw new HttpError(404, '試した絵が見つかりません');
    // 前のアイコンは、試した絵として残っていなければ消す
    if (c.avatar && c.avatar !== file && !tried.some((t) => t.file === c.avatar)) this.dropPlotImage(plotId, c.avatar);
    c.avatar = file;
    return this.store.plots.put(normalizePlot({ ...plot, updatedAt: Date.now() }));
  }

  // 候補を全部消して最初からにする。試した絵は、アイコンと立ち絵に使っていなければ消す
  wizardReset(plotId: string): PlotWizard {
    const plot = this.plotOf(plotId);
    const used = new Set([...plot.characters.flatMap((c) => [c.avatar, c.fullBody]), ...plot.players.map((p) => p.fullBody), plot.listing.cover]);
    for (const list of Object.values(this.store.getWizard(plotId).tries ?? {})) for (const t of list) if (!used.has(t.file)) this.dropPlotImage(plotId, t.file);
    return this.store.putWizard(emptyWizard(plotId));
  }

  // 紹介と会話の例を作る。挿絵の設定がまだない人がいれば、その人の分も作る
  async wizardFinish(plotId: string): Promise<{ plot: Plot; wizard: PlotWizard }> {
    const plot = this.plotOf(plotId);
    if (!plot.characters.length) throw new HttpError(400, 'キャラがまだいません');
    const settings = this.store.getSettings();
    const wizard = this.store.getWizard(plotId);
    const missing = illustMissing(plot);
    const [illust, listing] = await Promise.all([
      missing.length ? this.wizardJson(settings, buildFinishMessages('illust', plot, wizard, settings.llmPrompts), 'wizard_illust', WIZARD_ILLUST_SCHEMA, parseWizardIllust) : Promise.resolve([]),
      this.wizardJson(settings, buildFinishMessages('listing', plot, wizard, settings.llmPrompts), 'wizard_listing', WIZARD_LISTING_SCHEMA, parseWizardListing),
    ]);
    const next = normalizePlot({ ...applyWizardFinish(this.plotOf(plotId), illust, listing), updatedAt: Date.now() });
    const w = markChanged({ ...this.store.getWizard(plotId), finished: true }, 'finish');
    this.store.tx(() => {
      this.store.plots.put(next);
      this.store.putWizard(w);
    });
    return { plot: next, wizard: w };
  }
}

function lastInstruction(history: Message[]): string | undefined {
  const last = history[history.length - 1];
  if (last?.role !== 'user') return undefined;
  return last.swipes[last.activeSwipe]?.instruction;
}

export { USER_ID };

// 人ごとに残す試した絵の数
const WIZARD_TRY_KEEP = 8;

// サムネイルに描く人。キャラの id と、主人公を描くか
export interface CoverPeople {
  present?: string[];
  player?: boolean;
}
