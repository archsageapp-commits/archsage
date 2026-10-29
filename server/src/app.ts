import { readFileSync, existsSync, statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, extname } from 'node:path';
import { Hono, type Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import { serve } from '@hono/node-server';
import {
  normalizeLorebook,
  normalizeSafety,
  DEFAULT_PRESET,
  WIZARD_CANDIDATE_STEPS,
  makeResolver,
  newId,
  normalizeCharacter,
  normalizePlayer,
  normalizePlot,
  carriedOrigin,
  type BundleJson,
  pinEdits,
  textToParts,
  type Chat,
  type Connection,
  type Lorebook,
  type Message,
  type Plot,
  type Preset,
  type SceneState,
  type Settings,
  type WizardCandidateStep,
} from '@archsage/shared';
import { openDb, SCHEMA_VERSION } from './db.ts';
import { Store } from './store.ts';
import { Core, HttpError } from './core.ts';
import { comfyChoices, comfyStatus, detectNodeMap, validateWorkflow } from './comfy.ts';
import { listModels, listProviders } from './llm.ts';
import { exportLorebook, exportPlot, importBundle, importLorebook, importPlot } from './bundle.ts';
import { SiteLink, type PostOptions } from './siteLink.ts';
import type { AppPaths } from './paths.ts';

export const APP_VERSION = '0.1.1';

function wizardStep(v: string): WizardCandidateStep {
  if (!(WIZARD_CANDIDATE_STEPS as string[]).includes(v)) throw new HttpError(404, `手順の段が違います: ${v}`);
  return v as WizardCandidateStep;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function sanitizeSettings(s: Settings): Settings {
  return {
    ...s,
    connections: s.connections.map(({ apiKey, ...c }) => ({ ...c, hasApiKey: !!apiKey })),
    site: { url: s.site.url, user: s.site.user, connected: !!s.site.token },
  };
}

type IncomingConnection = Omit<Connection, 'apiKey'> & { apiKey?: string | null };

function mergeSettings(prev: Settings, patch: Partial<Settings> & { connections?: IncomingConnection[] }): Settings {
  const next: Settings = { ...prev, ...patch, connections: prev.connections } as Settings;
  if (patch.comfy) next.comfy = { ...prev.comfy, ...patch.comfy };
  if (patch.sampling) next.sampling = { ...prev.sampling, ...patch.sampling };
  // 画面から変えられるのは URL だけ。URL を変えたら、前のサイトとの連携は外す
  next.site = prev.site;
  if (patch.site && typeof patch.site.url === 'string') {
    const url = patch.site.url.trim().replace(/\/+$/, '');
    if (url !== prev.site.url) next.site = { url };
  }
  if (patch.connections) {
    next.connections = patch.connections.map((c) => {
      const old = prev.connections.find((o) => o.id === c.id);
      const { apiKey, hasApiKey: _h, ...rest } = c as IncomingConnection & { hasApiKey?: boolean };
      // apiKey を送らなければ前のまま、空なら消す
      const key = apiKey === undefined ? old?.apiKey : apiKey || undefined;
      return { ...rest, id: rest.id || newId(), apiKey: key };
    });
  }
  return next;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

async function readJson<T>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    throw new HttpError(400, 'JSONを読めませんでした');
  }
}

export interface AppOptions {
  paths: AppPaths; // リポジトリから動かすときは defaultPaths()、Electronは自分の置き場所を渡す
  port?: number;
}

export function createApp(opts: AppOptions) {
  const paths = opts.paths;
  const db = openDb(join(paths.dataDir, 'app.db'));
  const store = new Store(db);
  const core = new Core(store, paths);
  const site = new SiteLink(core);
  const app = new Hono();

  app.onError((err, c) => {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error(err);
    return c.json({ error: err.message }, status as 400);
  });

  // ほかのサイトから 127.0.0.1 への書き込みを防ぐ
  app.use('*', async (c, next) => {
    const host = (c.req.header('host') ?? '').replace(/:\d+$/, '');
    if (host && !['127.0.0.1', 'localhost', '[::1]'].includes(host)) return c.json({ error: '許可されていない接続です' }, 403);
    const origin = c.req.header('origin');
    if (c.req.method !== 'GET' && origin && !/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(origin)) {
      return c.json({ error: '許可されていない接続です' }, 403);
    }
    await next();
  });

  const api = new Hono();

  api.get('/health', (c) => c.json({ ok: true }));
  api.get('/info', (c) => c.json({ dataDir: paths.dataDir, schemaVersion: SCHEMA_VERSION, version: APP_VERSION }));
  api.post('/open-data-dir', (c) => {
    // 利用者のPCでフォルダを開く。サーバーは 127.0.0.1 でしか待ち受けない
    const cmd = process.platform === 'win32' ? 'explorer.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
    spawn(cmd, [paths.dataDir], { detached: true, stdio: 'ignore' }).unref();
    return c.json({ ok: true });
  });

  // ---- 設定 ----
  api.get('/settings', (c) => c.json(sanitizeSettings(store.getSettings())));
  api.put('/settings', async (c) => {
    const patch = await readJson<Partial<Settings>>(c);
    const next = store.putSettings(mergeSettings(store.getSettings(), patch));
    return c.json(sanitizeSettings(next));
  });
  api.post('/connections/models', async (c) => {
    const body = await readJson<IncomingConnection>(c);
    const saved = store.getSettings().connections.find((x) => x.id === body.id);
    const conn: Connection = { ...body, apiKey: body.apiKey === undefined ? saved?.apiKey : body.apiKey || undefined } as Connection;
    try {
      return c.json({ models: await listModels(conn) });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  // OpenRouterの提供元を安い順に
  api.post('/connections/providers', async (c) => {
    const body = await readJson<IncomingConnection & { model?: string }>(c);
    if (!body.model?.trim()) throw new HttpError(400, 'モデル名が空です');
    const saved = store.getSettings().connections.find((x) => x.id === body.id);
    const conn: Connection = { ...body, apiKey: body.apiKey === undefined ? saved?.apiKey : body.apiKey || undefined } as Connection;
    if (conn.kind !== 'openrouter') throw new HttpError(400, '提供元を選べるのはOpenRouterだけです');
    try {
      return c.json({ providers: await listProviders(conn, body.model.trim()) });
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
  api.get('/comfy/status', async (c) => c.json(await comfyStatus(c.req.query('url') || store.getSettings().comfy.url)));
  api.post('/comfy/workflow', async (c) => {
    const body = await readJson<{ workflow: unknown; name?: string }>(c);
    try {
      validateWorkflow(body.workflow);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    const map = detectNodeMap(body.workflow);
    const s = store.getSettings();
    s.comfy = { ...s.comfy, workflow: body.workflow as Record<string, unknown>, workflowName: body.name ?? 'workflow.json', nodeMap: map };
    store.putSettings(s);
    return c.json(sanitizeSettings(s));
  });
  api.delete('/comfy/workflow', (c) => {
    const s = store.getSettings();
    s.comfy = { ...s.comfy, workflow: null, workflowName: '', nodeMap: {} };
    store.putSettings(s);
    return c.json(sanitizeSettings(s));
  });
  // プリセットの欄（モデル、サンプラー、スケジューラー、LoRA）の選択肢と、ワークフローに書いてある値
  api.get('/comfy/options', async (c) => {
    const settings = store.getSettings();
    const { workflow, map } = core.workflowFor(settings);
    const nodes = workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
    const keys = ['model', 'steps', 'cfg', 'sampler', 'scheduler'] as const;
    const current: Partial<Record<(typeof keys)[number], string | number>> = {};
    const choices: Partial<Record<'model' | 'sampler' | 'scheduler' | 'lora', string[]>> = {};
    let error: string | undefined;
    for (const k of keys) {
      const ref = map[k];
      const node = ref ? nodes[ref.node] : undefined;
      if (!ref || !node?.class_type) continue;
      const v = node.inputs?.[ref.input];
      if (typeof v === 'string' || typeof v === 'number') current[k] = v;
      if (k === 'steps' || k === 'cfg' || error) continue;
      try {
        choices[k] = await comfyChoices(c.req.query('url') || settings.comfy.url, node.class_type, ref.input);
      } catch (e) {
        error = (e as Error).message;
      }
    }
    if (!error) {
      try {
        choices.lora = await comfyChoices(c.req.query('url') || settings.comfy.url, 'LoraLoaderModelOnly', 'lora_name');
      } catch (e) {
        error = (e as Error).message;
      }
    }
    return c.json({ choices, current, error });
  });
  api.get('/comfy/workflow/nodes', (c) => {
    const { workflow } = core.workflowFor(store.getSettings());
    const nodes = Object.entries(workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown>; _meta?: { title?: string } }>).map(([id, n]) => ({
      id,
      classType: n.class_type ?? '',
      title: n._meta?.title ?? '',
      inputs: Object.entries(n.inputs ?? {})
        .filter(([, v]) => !Array.isArray(v))
        .map(([k]) => k),
    }));
    return c.json({ nodes });
  });

  // ---- プロット ----
  api.get('/plots', (c) => c.json(store.plots.list()));
  api.post('/plots', async (c) => {
    const body = await readJson<Partial<Plot>>(c).catch(() => ({}) as Partial<Plot>);
    const now = Date.now();
    const plot = normalizePlot({ ...body, id: newId(), createdAt: now, updatedAt: now });
    return c.json(store.plots.put(plot));
  });
  api.get('/plots/:id', (c) => c.json(core.plotOf(c.req.param('id'))));
  api.put('/plots/:id', async (c) => {
    const prev = core.plotOf(c.req.param('id'));
    const body = await readJson<Partial<Plot>>(c);
    const plot = normalizePlot({ ...body, id: prev.id, createdAt: prev.createdAt, updatedAt: Date.now() });
    return c.json(store.plots.put(plot));
  });
  api.delete('/plots/:id', (c) => {
    const id = c.req.param('id');
    for (const ch of store.listChats(id)) core.removeImageDir('chats', ch.id);
    store.deletePlot(id);
    core.removeImageDir('plots', id);
    return c.json({ ok: true });
  });
  api.post('/plots/:id/duplicate', (c) => {
    const prev = core.plotOf(c.req.param('id'));
    const now = Date.now();
    // 複製は別の作品。投稿した印は外し、出どころとして引き継ぐ
    const plot = normalizePlot({ ...structuredClone(prev), id: newId(), title: `${prev.title}（コピー）`, createdAt: now, updatedAt: now, posted: undefined, origin: carriedOrigin(prev) });
    plot.listing.cover = core.copyPlotImage(plot.listing.cover, plot.id);
    for (const ch of plot.characters) {
      ch.avatar = core.copyPlotImage(ch.avatar, plot.id);
      ch.fullBody = core.copyPlotImage(ch.fullBody, plot.id);
    }
    for (const pl of plot.players) pl.fullBody = core.copyPlotImage(pl.fullBody, plot.id);
    return c.json(store.plots.put(plot));
  });
  api.get('/plots/:id/export', (c) => {
    const plot = core.plotOf(c.req.param('id'));
    const zip = exportPlot(core, plot.id);
    const name = encodeURIComponent(`${plot.title || 'plot'}.zip`);
    return c.body(zip as Uint8Array<ArrayBuffer>, 200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename*=UTF-8''${name}`,
    });
  });
  api.post('/plots/import', async (c) => {
    const buf = new Uint8Array(await c.req.arrayBuffer());
    return c.json(importPlot(core, buf));
  });
  api.post('/plots/sample', (c) => {
    const json = JSON.parse(readFileSync(join(paths.assetsDir, 'samples', 'houkago.json'), 'utf8')) as BundleJson;
    return c.json(importBundle(core, json, {}));
  });
  api.post('/plots/:id/images', async (c) => {
    const { kind, charId, request } = await readJson<{ kind: 'cover' | 'avatar'; charId?: string; request?: string }>(c);
    const rel = await core.generatePlotImage(c.req.param('id'), kind, charId, typeof request === 'string' ? request : '');
    return c.json(setPlotImage(c.req.param('id'), kind, charId, rel));
  });
  api.post('/plots/:id/upload', async (c) => {
    const kind = c.req.query('kind') as 'cover' | 'avatar';
    const charId = c.req.query('charId');
    const type = c.req.header('content-type') ?? '';
    const ext = type.includes('jpeg') ? 'jpg' : type.includes('webp') ? 'webp' : 'png';
    const rel = `plots/${c.req.param('id')}/${kind}-${newId(8)}.${ext}`;
    core.saveImage(rel, Buffer.from(await c.req.arrayBuffer()));
    return c.json(setPlotImage(c.req.param('id'), kind, charId, rel));
  });

  function setPlotImage(plotId: string, kind: 'cover' | 'avatar', charId: string | undefined, rel: string): Plot {
    const plot = core.plotOf(plotId);
    // 差し替えた前の画像は、このシナリオのものなら消す
    const drop = (old: string | undefined) => {
      if (old && old !== rel && old.startsWith(`plots/${plotId}/`)) core.removeImages([{ id: '', status: 'done', createdAt: 0, file: old }]);
    };
    if (kind === 'cover') {
      drop(plot.listing.cover);
      plot.listing.cover = rel;
    } else {
      const ch = plot.characters.find((x) => x.id === charId);
      if (!ch) throw new HttpError(404, 'キャラが見つかりません');
      drop(ch.avatar);
      ch.avatar = rel;
    }
    plot.updatedAt = Date.now();
    return store.plots.put(plot);
  }

  // シナリオを手順で作る
  api.get('/plots/:id/wizard', (c) => c.json(store.getWizard(core.plotOf(c.req.param('id')).id)));
  api.put('/plots/:id/wizard', async (c) => {
    const { concept } = await readJson<{ concept?: string }>(c);
    const w = store.getWizard(core.plotOf(c.req.param('id')).id);
    return c.json(store.putWizard({ ...w, concept: typeof concept === 'string' ? concept : w.concept }));
  });
  api.delete('/plots/:id/wizard', (c) => c.json(core.wizardReset(core.plotOf(c.req.param('id')).id)));
  api.post('/plots/:id/wizard/finish', async (c) => c.json(await core.wizardFinish(c.req.param('id'))));
  // キャラと主人公は1人ずつ作る。target はキャラの id か new（足す）か player
  api.post('/plots/:id/wizard/person/:target', async (c) => {
    const { request } = await readJson<{ request?: string }>(c).catch(() => ({}) as { request?: string });
    return c.json(await core.wizardPerson(c.req.param('id'), c.req.param('target'), (request ?? '').trim()));
  });
  api.post('/plots/:id/wizard/person/:target/undo', (c) => c.json(core.wizardUndo(c.req.param('id'), c.req.param('target'))));
  api.delete('/plots/:id/wizard/person/:target', (c) => c.json(core.wizardRemove(c.req.param('id'), c.req.param('target'))));
  api.post('/plots/:id/wizard/person/:target/try', async (c) => {
    const { kind } = await readJson<{ kind?: string }>(c);
    if (kind !== 'full' && kind !== 'bust') throw new HttpError(400, '絵の種類が違います');
    return c.json(await core.wizardTry(c.req.param('id'), c.req.param('target'), kind));
  });
  api.post('/plots/:id/wizard/person/:target/icon', async (c) => {
    const { file } = await readJson<{ file?: string }>(c);
    return c.json(core.wizardIcon(c.req.param('id'), c.req.param('target'), String(file ?? '')));
  });
  // サムネイルを描く。注文は自由に書ける
  api.post('/plots/:id/wizard/cover', async (c) => {
    const body = await readJson<{ request?: string; present?: unknown; player?: unknown }>(c).catch(() => ({}) as { request?: string; present?: unknown; player?: unknown });
    const present = Array.isArray(body.present) ? body.present.filter((x): x is string => typeof x === 'string') : undefined;
    const player = typeof body.player === 'boolean' ? body.player : undefined;
    return c.json(await core.wizardCover(c.req.param('id'), String(body.request ?? '').trim().slice(0, 1000), { present, player }));
  });
  api.post('/plots/:id/wizard/cover/use', async (c) => {
    const { file } = await readJson<{ file?: string }>(c);
    return c.json(core.wizardUseCover(c.req.param('id'), String(file ?? '')));
  });
  api.post('/plots/:id/wizard/:step', async (c) => {
    const step = wizardStep(c.req.param('step'));
    const { request, present } = await readJson<{ request?: string; present?: unknown }>(c).catch(() => ({}) as { request?: string; present?: unknown });
    const ids = Array.isArray(present) ? present.filter((x): x is string => typeof x === 'string') : undefined;
    return c.json(await core.wizardGenerate(c.req.param('id'), step, (request ?? '').trim(), ids));
  });
  api.post('/plots/:id/wizard/:step/choose', async (c) => {
    const step = wizardStep(c.req.param('step'));
    const { index, candidate, mode } = await readJson<{ index: number; candidate: Record<string, unknown>; mode?: string }>(c);
    if (typeof index !== 'number' || !candidate || typeof candidate !== 'object') throw new HttpError(400, '選んだ候補の形が違います');
    return c.json(core.wizardChoose(c.req.param('id'), step, index, candidate, mode === 'add' ? 'add' : 'replace'));
  });

  // ---- プレイヤー、設定集、プリセット ----
  api.get('/players', (c) => c.json(store.players.list()));
  api.post('/players', async (c) => c.json(store.players.put(normalizePlayer({ ...(await readJson(c)), id: newId() }))));
  api.put('/players/:id', async (c) => c.json(store.players.put(normalizePlayer({ ...(await readJson(c)), id: c.req.param('id') }))));
  api.delete('/players/:id', (c) => {
    store.players.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  api.get('/lorebooks', (c) => c.json(store.lorebooks.list()));
  api.post('/lorebooks', async (c) => c.json(store.lorebooks.put(normalizeLorebook({ ...(await readJson<Partial<Lorebook>>(c)), posted: undefined, origin: undefined }, newId()))));
  api.put('/lorebooks/:id', async (c) => c.json(store.lorebooks.put(normalizeLorebook(await readJson<Partial<Lorebook>>(c), c.req.param('id')))));
  api.get('/lorebooks/:id/export', (c) => {
    const book = store.lorebooks.get(c.req.param('id'));
    if (!book) throw new HttpError(404, '設定集が見つかりません');
    const name = encodeURIComponent(`${book.name || 'lorebook'}.zip`);
    return c.body(exportLorebook(core, book.id) as Uint8Array<ArrayBuffer>, 200, {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename*=UTF-8''${name}`,
    });
  });
  api.post('/lorebooks/import', async (c) => c.json(importLorebook(core, new Uint8Array(await c.req.arrayBuffer()))));
  api.delete('/lorebooks/:id', (c) => {
    store.lorebooks.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  api.get('/presets', (c) => c.json(store.presets.list()));
  const normPreset = (p: Partial<Preset>, id: string): Preset => ({ id, name: p.name ?? '', systemPrompt: p.systemPrompt ?? '', postHistory: p.postHistory ?? '' });
  api.post('/presets', async (c) => c.json(store.presets.put(normPreset(await readJson(c), newId()))));
  api.put('/presets/:id', async (c) => c.json(store.presets.put(normPreset(await readJson(c), c.req.param('id')))));
  api.post('/presets/:id/reset', (c) => {
    if (c.req.param('id') !== DEFAULT_PRESET.id) throw new HttpError(400, '初期化できるのは最初からある語り手の指示だけです');
    return c.json(store.presets.put(DEFAULT_PRESET));
  });
  api.delete('/presets/:id', (c) => {
    if (c.req.param('id') === DEFAULT_PRESET.id) throw new HttpError(400, '最初からある語り手の指示は消せません');
    store.presets.delete(c.req.param('id'));
    return c.json({ ok: true });
  });

  // ---- チャット ----
  const chatView = (id: string) => ({
    chat: core.chatOf(id),
    player: core.playerOf(core.chatOf(id), core.plotOf(core.chatOf(id).plotId)),
    messages: store.listMessages(id),
    summaries: store.listSummaries(id),
    busy: core.chatQueue.busy(id),
  });
  api.get('/chats', (c) => c.json(store.listChats(c.req.query('plotId') || undefined)));
  api.post('/chats', async (c) => {
    const body = await readJson<Partial<Chat> & { plotId: string }>(c);
    const { chat } = await core.createChat(body);
    return c.json(chatView(chat.id));
  });
  api.get('/chats/:id', (c) => c.json(chatView(c.req.param('id'))));
  api.patch('/chats/:id', async (c) => {
    const chat = core.chatOf(c.req.param('id'));
    const body = await readJson<Partial<Chat>>(c);
    const allowed: (keyof Chat)[] = ['title', 'mode', 'safety', 'userMode', 'autoIllustrate', 'illustTime', 'illustWeather', 'styleOverride', 'presetId', 'player'];
    for (const k of allowed) if (k in body) (chat as unknown as Record<string, unknown>)[k] = body[k];
    if ('safety' in body) chat.safety = normalizeSafety(body.safety);
    return c.json(store.putChat(chat));
  });
  api.delete('/chats/:id', (c) => {
    store.deleteChat(c.req.param('id'));
    core.removeImageDir('chats', c.req.param('id'));
    return c.json({ ok: true });
  });
  api.post('/chats/:id/generate', async (c) => {
    const body = await readJson<{ text?: string; instruction?: string; regenerate?: boolean }>(c);
    const m = await core.generate(c.req.param('id'), body);
    return c.json({ message: m ?? null, ...chatView(c.req.param('id')) });
  });
  api.post('/chats/:id/stop', (c) => c.json({ stopped: core.stopGenerate(c.req.param('id')) }));
  api.post('/chats/:id/preview', async (c) => {
    const body = await readJson<{ text?: string; instruction?: string; regenerate?: boolean }>(c);
    return c.json(core.previewChat(c.req.param('id'), body));
  });
  api.get('/chats/:id/requests', (c) => c.json(core.lastRequests.get(c.req.param('id')) ?? []));

  api.patch('/chats/:id/messages/:mid', async (c) => {
    const chatId = c.req.param('id');
    const chat = core.chatOf(chatId);
    const m = store.getMessage(c.req.param('mid'));
    if (!m || m.chatId !== chatId) throw new HttpError(404, 'メッセージが見つかりません');
    const body = await readJson<{ activeSwipe?: number; text?: string; instruction?: string; state?: SceneState }>(c);
    if (typeof body.activeSwipe === 'number') {
      if (body.activeSwipe < 0 || body.activeSwipe >= m.swipes.length) throw new HttpError(400, 'スワイプの番号が範囲外です');
      m.activeSwipe = body.activeSwipe;
    }
    const swipe = m.swipes[m.activeSwipe];
    if (typeof body.text === 'string') {
      const plot = core.plotOf(chat.plotId);
      const player = core.playerOf(chat, plot);
      swipe.text = body.text;
      if (m.role === 'assistant') {
        swipe.parts = textToParts(body.text, makeResolver(plot, player));
        swipe.error = undefined;
      }
      core.markSummariesStale(chatId, m.id);
      store.putMessage(m);
      core.refreshStaleSummaries(chatId);
    }
    // 展開の指示は、次の返答を作り直すときに使う。要約には入らない
    if (typeof body.instruction === 'string' && m.role === 'user') swipe.instruction = body.instruction.trim() || undefined;
    if (body.state) {
      // 手で直した欄は、物語の中で変わるまで毎回チャットに送る
      const pins = pinEdits(chat.pins ?? [], swipe.state, body.state);
      swipe.state = body.state;
      if (JSON.stringify(pins) !== JSON.stringify(chat.pins ?? [])) {
        chat.pins = pins;
        store.putChat(chat);
      }
    }
    store.putMessage(m);
    return c.json(chatView(chatId));
  });
  api.delete('/chats/:id/messages/:mid', (c) => {
    const chatId = c.req.param('id');
    const m = store.getMessage(c.req.param('mid'));
    if (!m || m.chatId !== chatId) throw new HttpError(404, 'メッセージが見つかりません');
    const swipeQ = c.req.query('swipe');
    if (swipeQ !== undefined && m.swipes.length > 1) {
      const i = Number(swipeQ);
      if (!(i >= 0 && i < m.swipes.length)) throw new HttpError(400, 'スワイプの番号が範囲外です');
      const [removed] = m.swipes.splice(i, 1);
      core.removeImages(removed.images);
      // 前のスワイプを消したら、見ている番号を1つ詰める
      if (i < m.activeSwipe) m.activeSwipe -= 1;
      m.activeSwipe = Math.min(m.activeSwipe, m.swipes.length - 1);
      store.putMessage(m);
      core.markSummariesStale(chatId, m.id);
    } else {
      core.beforeDeleteMessage(chatId, m.id);
      store.deleteMessage(m.id);
      for (const s of m.swipes) core.removeImages(s.images);
    }
    core.refreshStaleSummaries(chatId);
    return c.json(chatView(chatId));
  });
  api.post('/chats/:id/messages/:mid/illustrate', async (c) => {
    const body = await readJson<{ swipe?: number; reseedImageId?: string }>(c).catch(() => ({}) as { swipe?: number; reseedImageId?: string });
    const img = await core.illustrate(c.req.param('id'), c.req.param('mid'), body.swipe, { reseedImageId: body.reseedImageId });
    return c.json(img);
  });
  api.delete('/chats/:id/messages/:mid/images/:imgId', (c) => {
    const m = store.getMessage(c.req.param('mid'));
    if (!m) throw new HttpError(404, 'メッセージが見つかりません');
    for (const s of m.swipes) {
      core.removeImages(s.images.filter((i) => i.id === c.req.param('imgId')));
      s.images = s.images.filter((i) => i.id !== c.req.param('imgId'));
    }
    store.putMessage(m);
    return c.json(chatView(c.req.param('id')));
  });

  api.put('/chats/:id/summaries/:sid', async (c) => {
    const { text } = await readJson<{ text: string }>(c);
    const s = store.listSummaries(c.req.param('id')).find((x) => x.id === c.req.param('sid'));
    if (!s) throw new HttpError(404, '要約が見つかりません');
    s.text = text;
    s.stale = false;
    store.putSummary(s);
    return c.json(chatView(c.req.param('id')));
  });
  api.post('/chats/:id/summaries/:sid/redo', async (c) => {
    await core.resummarize(c.req.param('id'), c.req.param('sid'));
    return c.json(chatView(c.req.param('id')));
  });
  api.delete('/chats/:id/summaries/:sid', (c) => {
    store.deleteSummary(c.req.param('sid'));
    return c.json(chatView(c.req.param('id')));
  });

  // ---- イベント ----
  api.get('/events', (c) =>
    streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let wake: (() => void) | undefined;
      const off = core.hub.subscribe((e) => {
        queue.push(JSON.stringify(e));
        wake?.();
      });
      stream.onAbort(() => {
        off();
        wake?.();
      });
      await stream.writeSSE({ event: 'hello', data: '{}' });
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ data: queue.shift() as string });
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 25_000);
        });
        wake = undefined;
        if (queue.length === 0 && !stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      off();
    }),
  );

  // ---- 投稿サイト ----
  // 戻り先は、画面を開いているこのサーバーのポート。サイトは 127.0.0.1 だけを受け付ける
  api.post('/site/connect', async (c) => c.json(await site.beginConnect(new URL(c.req.url).port || '80')));
  api.post('/site/disconnect', async (c) => {
    await site.disconnect();
    return c.json(sanitizeSettings(store.getSettings()));
  });
  api.get('/site/account', async (c) => c.json(await site.account()));
  api.post('/site/terms', async (c) => {
    const { termsVersion } = await readJson<{ termsVersion: number }>(c);
    await site.agreeTerms(termsVersion);
    return c.json({ ok: true });
  });
  api.get('/site/posts', async (c) => c.json({ posts: await site.myPosts() }));
  api.post('/plots/:id/post', async (c) => c.json(await site.post(c.req.param('id'), await readJson<PostOptions>(c))));
  api.post('/plots/:id/withdraw', async (c) => c.json(await site.withdraw(c.req.param('id'))));
  api.post('/lorebooks/:id/post', async (c) => c.json(await site.postLorebook(c.req.param('id'), await readJson<PostOptions>(c))));
  api.post('/lorebooks/:id/withdraw', async (c) => c.json(await site.withdrawLorebook(c.req.param('id'))));
  api.post('/site/open', async (c) => {
    const { post, ticket } = await readJson<{ post: string; ticket?: string }>(c);
    return c.json(await site.open(String(post ?? ''), ticket ? String(ticket) : undefined));
  });
  api.post('/site/open/:key', (c) => c.json(site.importOpened(c.req.param('key'))));

  app.route('/api', api);

  // 画面の「サイトにつなぐ」はいつものブラウザでここを開き、サイトの許可の画面に移る
  app.get('/site/connect/start', async (c) => c.redirect((await site.beginConnect(new URL(c.req.url).port || '80')).authorizeUrl));

  // サイトで「許可する」を押したあと、ブラウザがここに戻ってくる
  app.get('/site/callback', async (c) => {
    const page = (title: string, text: string) =>
      // 色はアプリの生成りにそろえる
      c.html(
        `<!doctype html><html lang="ja"><meta charset="utf-8"><link rel="icon" href="/favicon.svg"><title>${title}</title><body style="margin:0;font-family:'Noto Sans JP','Hiragino Sans','Yu Gothic UI','Meiryo',system-ui,sans-serif;background:#f5f1e8;color:#2a241c"><div style="max-width:520px;margin:64px auto;padding:28px;background:#fffcf6;border:1px solid #e0d5c2;border-radius:12px;text-align:center"><img src="/favicon.svg" alt="" width="44" height="44"><h1 style="font-size:20px;margin:12px 0 8px">${title}</h1><p style="color:#5f5648;margin:0">${text}</p></div></body></html>`,
      );
    try {
      const name = await site.finishConnect(c.req.query('state') ?? '', c.req.query('code'), c.req.query('error'));
      return page('連携しました', `${escapeHtml(name)} として連携しました。このページを閉じて、アプリに戻ってください`);
    } catch (e) {
      return page('連携できませんでした', escapeHtml((e as Error).message));
    }
  });

  // ---- 画像と画面 ----
  app.get('/images/*', (c) => {
    const rel = decodeURIComponent(c.req.path.slice('/images/'.length));
    const full = core.imagePath(rel);
    if (!full) return c.notFound();
    return c.body(readFileSync(full), 200, {
      'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    });
  });
  app.get('*', (c) => {
    const rel = decodeURIComponent(c.req.path).replace(/^\/+/, '');
    if (rel.includes('..')) return c.notFound();
    let full = join(paths.webDir, rel);
    if (!rel || !existsSync(full) || statSync(full).isDirectory()) full = join(paths.webDir, 'index.html');
    if (!existsSync(full)) return c.text('画面がまだビルドされていません。npm run build -w web を実行してください', 503);
    const isAsset = rel.startsWith('assets/');
    return c.body(readFileSync(full), 200, {
      'content-type': MIME[extname(full).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
  });

  return { app, core, store, db, paths };
}

export function startServer(opts: AppOptions & { port?: number }) {
  const ctx = createApp(opts);
  const port = opts.port ?? Number(process.env.ARCHSAGE_PORT ?? 8790);
  const server = serve({ fetch: ctx.app.fetch, hostname: '127.0.0.1', port });
  return { ...ctx, server, port, url: `http://127.0.0.1:${port}` };
}

// 決めたポートが使われていたら、空いているポートで待ち受ける
export function listenServer(opts: AppOptions & { port: number }): Promise<ReturnType<typeof createApp> & { url: string; port: number; close: () => void }> {
  const ctx = createApp(opts);
  const tryPort = (port: number) =>
    new Promise<number>((resolve, reject) => {
      const server = serve({ fetch: ctx.app.fetch, hostname: '127.0.0.1', port });
      server.once('error', reject);
      server.once('listening', () => {
        const addr = server.address();
        closeFn = () => server.close();
        resolve(typeof addr === 'object' && addr ? addr.port : port);
      });
    });
  let closeFn = () => undefined as void;
  return tryPort(opts.port)
    .catch(() => tryPort(0))
    .then((port) => ({ ...ctx, port, url: `http://127.0.0.1:${port}`, close: () => closeFn() }));
}

export type { Message };
