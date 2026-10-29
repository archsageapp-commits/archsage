import type {
  Chat,
  ChatPrompt,
  Connection,
  ImageRef,
  Lorebook,
  Message,
  Player,
  Plot,
  PlotWizard,
  Preset,
  Rating,
  ProviderOption,
  Settings,
  Summary,
  WizardCandidates,
  WizardCandidateStep,
} from '@archsage/shared';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function req<T>(method: string, path: string, body?: unknown, raw?: BodyInit, headers?: Record<string, string>): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: raw ? headers : body === undefined ? undefined : { 'content-type': 'application/json' },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && typeof data === 'object' && 'error' in data ? String((data as { error: string }).error) : '') || `エラー（${res.status}）`;
    throw new ApiError(res.status, msg);
  }
  return data as T;
}

export interface ChatView {
  chat: Chat;
  messages: Message[];
  summaries: Summary[];
  busy: boolean;
  player: Player; // この会話で演じる人物
}

export interface LastRequest {
  kind: 'chat' | 'illust' | 'summary';
  at: number;
  messages: { role: string; content: string }[];
  activatedLore?: ChatPrompt['activatedLore'];
  tokens?: ChatPrompt['tokens'];
  raw?: string;
  error?: string;
}

export interface WorkflowNode {
  id: string;
  classType: string;
  title: string;
  inputs: string[];
}

// プリセットの欄の選択肢と、ワークフローに書いてある値
export interface ComfyOptions {
  choices: Partial<Record<'model' | 'sampler' | 'scheduler' | 'lora', string[]>>;
  current: Partial<Record<'model' | 'steps' | 'cfg' | 'sampler' | 'scheduler', string | number>>;
  error?: string;
}

// 投稿サイトの自分の投稿の状態
export interface SitePost {
  id: string;
  kind: 'plot' | 'lorebook';
  title: string;
  status: 'live' | 'hidden' | 'withdrawn';
  visibility: 'public' | 'unlisted';
  rating: Rating;
  hiddenReason: string | null;
  updatedAt: number;
  url: string;
}

export interface SiteAccount {
  displayName: string;
  adult: boolean;
  termsVersion: number;
  currentTermsVersion: number;
  termsUrl: string;
}

export interface PostOptions {
  visibility: 'public' | 'unlisted';
  rating: Rating;
  sourceTitle: string;
  imagesChecked: boolean;
  target: 'new' | 'update';
}

export interface OpenPreview {
  key: string;
  kind: 'plot' | 'lorebook';
  entries?: number;
  title: string;
  authorName: string;
  rating: Rating;
  tagline: string;
  cover?: string;
}

export const api = {
  settings: () => req<Settings>('GET', '/settings'),
  info: () => req<{ dataDir: string; schemaVersion: number; version: string }>('GET', '/info'),
  openDataDir: () => req<{ ok: true }>('POST', '/open-data-dir'),
  saveSettings: (s: Omit<Partial<Settings>, 'connections'> & { connections?: (Omit<Connection, 'apiKey'> & { apiKey?: string | null })[] }) => req<Settings>('PUT', '/settings', s),
  models: (c: Omit<Partial<Connection>, 'apiKey'> & { apiKey?: string | null }) => req<{ models: string[] }>('POST', '/connections/models', c),
  providers: (c: Omit<Partial<Connection>, 'apiKey'> & { apiKey?: string | null }, model: string) => req<{ providers: ProviderOption[] }>('POST', '/connections/providers', { ...c, model }),
  comfyStatus: (url?: string) => req<{ ok: boolean; version?: string; error?: string }>('GET', `/comfy/status${url ? `?url=${encodeURIComponent(url)}` : ''}`),
  loadWorkflow: (workflow: unknown, name: string) => req<Settings>('POST', '/comfy/workflow', { workflow, name }),
  resetWorkflow: () => req<Settings>('DELETE', '/comfy/workflow'),
  comfyOptions: (url?: string) => req<ComfyOptions>('GET', `/comfy/options${url ? `?url=${encodeURIComponent(url)}` : ''}`),
  workflowNodes: () => req<{ nodes: WorkflowNode[] }>('GET', '/comfy/workflow/nodes'),

  plots: () => req<Plot[]>('GET', '/plots'),
  plot: (id: string) => req<Plot>('GET', `/plots/${id}`),
  createPlot: (p: Partial<Plot> = {}) => req<Plot>('POST', '/plots', p),
  savePlot: (p: Plot) => req<Plot>('PUT', `/plots/${p.id}`, p),
  deletePlot: (id: string) => req<{ ok: true }>('DELETE', `/plots/${id}`),
  duplicatePlot: (id: string) => req<Plot>('POST', `/plots/${id}/duplicate`),
  addSample: () => req<Plot>('POST', '/plots/sample'),
  importPlot: (file: File) => req<Plot>('POST', '/plots/import', undefined, file, { 'content-type': 'application/zip' }),
  exportUrl: (id: string) => `/api/plots/${id}/export`,
  siteConnect: () => req<{ authorizeUrl: string }>('POST', '/site/connect'),
  siteDisconnect: () => req<Settings>('POST', '/site/disconnect'),
  siteAccount: () => req<SiteAccount>('GET', '/site/account'),
  siteTerms: (termsVersion: number) => req<{ ok: true }>('POST', '/site/terms', { termsVersion }),
  sitePosts: () => req<{ posts: SitePost[] }>('GET', '/site/posts'),
  postPlot: (id: string, o: PostOptions) => req<{ plot: Plot; url: string }>('POST', `/plots/${id}/post`, o),
  withdrawPlot: (id: string) => req<Plot>('POST', `/plots/${id}/withdraw`),
  siteOpen: (post: string, ticket?: string) => req<OpenPreview>('POST', '/site/open', { post, ticket }),
  siteImport: (key: string) => req<{ plot: Plot } | { lorebook: Lorebook }>('POST', `/site/open/${key}`),
  postLorebook: (id: string, o: PostOptions) => req<{ lorebook: Lorebook; url: string }>('POST', `/lorebooks/${id}/post`, o),
  withdrawLorebook: (id: string) => req<Lorebook>('POST', `/lorebooks/${id}/withdraw`),
  plotImage: (id: string, kind: 'cover' | 'avatar', charId?: string) => req<Plot>('POST', `/plots/${id}/images`, { kind, charId }),
  uploadPlotImage: (id: string, kind: 'cover' | 'avatar', file: File, charId?: string) =>
    req<Plot>('POST', `/plots/${id}/upload?kind=${kind}${charId ? `&charId=${charId}` : ''}`, undefined, file, { 'content-type': file.type || 'image/png' }),

  wizard: (plotId: string) => req<PlotWizard>('GET', `/plots/${plotId}/wizard`),
  saveWizard: (plotId: string, patch: { concept?: string }) => req<PlotWizard>('PUT', `/plots/${plotId}/wizard`, patch),
  resetWizard: (plotId: string) => req<PlotWizard>('DELETE', `/plots/${plotId}/wizard`),
  wizardGenerate: (plotId: string, step: WizardCandidateStep, request = '', present?: string[]) => req<PlotWizard>('POST', `/plots/${plotId}/wizard/${step}`, { request, present }),
  wizardChoose: <K extends WizardCandidateStep>(plotId: string, step: K, index: number, candidate: WizardCandidates[K], mode: 'replace' | 'add' = 'replace') =>
    req<{ plot: Plot; wizard: PlotWizard }>('POST', `/plots/${plotId}/wizard/${step}/choose`, { index, candidate, mode }),
  // target はキャラの id か new（足す）か player
  wizardPerson: (plotId: string, target: string, request = '') => req<{ plot: Plot; wizard: PlotWizard; id: string }>('POST', `/plots/${plotId}/wizard/person/${target}`, { request }),
  wizardUndo: (plotId: string, target: string) => req<{ plot: Plot; wizard: PlotWizard }>('POST', `/plots/${plotId}/wizard/person/${target}/undo`),
  wizardRemove: (plotId: string, charId: string) => req<{ plot: Plot; wizard: PlotWizard }>('DELETE', `/plots/${plotId}/wizard/person/${charId}`),
  wizardTry: (plotId: string, target: string, kind: 'full' | 'bust') => req<{ plot: Plot; wizard: PlotWizard }>('POST', `/plots/${plotId}/wizard/person/${target}/try`, { kind }),
  wizardIcon: (plotId: string, charId: string, file: string) => req<Plot>('POST', `/plots/${plotId}/wizard/person/${charId}/icon`, { file }),
  // present は描くキャラの id、player は主人公も描くか
  wizardCover: (plotId: string, request: string, present?: string[], player?: boolean) => req<{ plot: Plot; wizard: PlotWizard }>('POST', `/plots/${plotId}/wizard/cover`, { request, present, player }),
  wizardUseCover: (plotId: string, file: string) => req<Plot>('POST', `/plots/${plotId}/wizard/cover/use`, { file }),
  wizardFinish: (plotId: string) => req<{ plot: Plot; wizard: PlotWizard }>('POST', `/plots/${plotId}/wizard/finish`),


  lorebooks: () => req<Lorebook[]>('GET', '/lorebooks'),
  createLorebook: (b: Partial<Lorebook>) => req<Lorebook>('POST', '/lorebooks', b),
  saveLorebook: (b: Lorebook) => req<Lorebook>('PUT', `/lorebooks/${b.id}`, b),
  deleteLorebook: (id: string) => req<{ ok: true }>('DELETE', `/lorebooks/${id}`),
  importLorebook: (file: File) => req<Lorebook>('POST', '/lorebooks/import', undefined, file, { 'content-type': 'application/zip' }),
  lorebookExportUrl: (id: string) => `/api/lorebooks/${id}/export`,

  presets: () => req<Preset[]>('GET', '/presets'),
  createPreset: (p: Partial<Preset>) => req<Preset>('POST', '/presets', p),
  savePreset: (p: Preset) => req<Preset>('PUT', `/presets/${p.id}`, p),
  resetPreset: (id: string) => req<Preset>('POST', `/presets/${id}/reset`),
  deletePreset: (id: string) => req<{ ok: true }>('DELETE', `/presets/${id}`),

  chats: (plotId?: string) => req<Chat[]>('GET', `/chats${plotId ? `?plotId=${plotId}` : ''}`),
  createChat: (c: Partial<Chat> & { plotId: string }) => req<ChatView>('POST', '/chats', c),
  chat: (id: string) => req<ChatView>('GET', `/chats/${id}`),
  patchChat: (id: string, patch: Partial<Chat>) => req<Chat>('PATCH', `/chats/${id}`, patch),
  deleteChat: (id: string) => req<{ ok: true }>('DELETE', `/chats/${id}`),
  stopGenerate: (id: string) => req<{ stopped: boolean }>('POST', `/chats/${id}/stop`),
  generate: (id: string, body: { text?: string; instruction?: string; regenerate?: boolean }) =>
    req<ChatView & { message: Message }>('POST', `/chats/${id}/generate`, body),
  preview: (id: string, body: { text?: string; instruction?: string; regenerate?: boolean }) => req<ChatPrompt>('POST', `/chats/${id}/preview`, body),
  requests: (id: string) => req<LastRequest[]>('GET', `/chats/${id}/requests`),
  patchMessage: (chatId: string, mid: string, patch: { activeSwipe?: number; text?: string; instruction?: string; state?: unknown }) =>
    req<ChatView>('PATCH', `/chats/${chatId}/messages/${mid}`, patch),
  deleteMessage: (chatId: string, mid: string, swipe?: number) =>
    req<ChatView>('DELETE', `/chats/${chatId}/messages/${mid}${swipe !== undefined ? `?swipe=${swipe}` : ''}`),
  illustrate: (chatId: string, mid: string, body: { swipe?: number; reseedImageId?: string } = {}) =>
    req<ImageRef>('POST', `/chats/${chatId}/messages/${mid}/illustrate`, body),
  deleteImage: (chatId: string, mid: string, imgId: string) => req<ChatView>('DELETE', `/chats/${chatId}/messages/${mid}/images/${imgId}`),
  saveSummary: (chatId: string, sid: string, text: string) => req<ChatView>('PUT', `/chats/${chatId}/summaries/${sid}`, { text }),
  redoSummary: (chatId: string, sid: string) => req<ChatView>('POST', `/chats/${chatId}/summaries/${sid}/redo`),
  deleteSummary: (chatId: string, sid: string) => req<ChatView>('DELETE', `/chats/${chatId}/summaries/${sid}`),
};

export function imageUrl(rel: string | undefined): string | undefined {
  return rel ? `/images/${rel.split('/').map(encodeURIComponent).join('/')}` : undefined;
}
