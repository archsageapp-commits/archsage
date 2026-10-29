import type { DatabaseSync } from 'node:sqlite';
import {
  DEFAULT_PRESET,
  defaultSettings,
  emptyWizard,
  type Chat,
  type ImageProfile,
  type Lorebook,
  type Message,
  type Player,
  type Plot,
  type PlotWizard,
  type Preset,
  type Settings,
  type Summary,
} from '@archsage/shared';

type Row = { data: string };

function parse<T>(row: unknown): T {
  return JSON.parse((row as Row).data) as T;
}

// id と data だけを持つ表の読み書き
class DocTable<T extends { id: string }> {
  db: DatabaseSync;
  table: string;
  constructor(db: DatabaseSync, table: string) {
    this.db = db;
    this.table = table;
  }
  list(): T[] {
    return this.db.prepare(`select data from ${this.table} order by updated_at desc`).all().map((r) => parse<T>(r));
  }
  get(id: string): T | undefined {
    const r = this.db.prepare(`select data from ${this.table} where id = ?`).get(id);
    return r ? parse<T>(r) : undefined;
  }
  put(doc: T): T {
    this.db
      .prepare(`insert into ${this.table} (id, data, updated_at) values (?, ?, ?) on conflict(id) do update set data = excluded.data, updated_at = excluded.updated_at`)
      .run(doc.id, JSON.stringify(doc), Date.now());
    return doc;
  }
  delete(id: string): void {
    this.db.prepare(`delete from ${this.table} where id = ?`).run(id);
  }
}

export class Store {
  db: DatabaseSync;
  plots: DocTable<Plot>;
  players: DocTable<Player>;
  lorebooks: DocTable<Lorebook>;
  presets: DocTable<Preset>;

  constructor(db: DatabaseSync) {
    this.db = db;
    this.plots = new DocTable<Plot>(db, 'plots');
    this.players = new DocTable<Player>(db, 'players');
    this.lorebooks = new DocTable<Lorebook>(db, 'lorebooks');
    this.presets = new DocTable<Preset>(db, 'presets');
    const preset = this.presets.get(DEFAULT_PRESET.id);
    if (!preset) this.presets.put(DEFAULT_PRESET);
    // 前の既定の名前は、ページの名前（基本の指示）と同じだった。変えていなければ新しい名前にする
    else if (preset.name === '基本の指示') this.presets.put({ ...preset, name: DEFAULT_PRESET.name });
  }

  tx<R>(fn: () => R): R {
    this.db.exec('begin');
    try {
      const r = fn();
      this.db.exec('commit');
      return r;
    } catch (e) {
      this.db.exec('rollback');
      throw e;
    }
  }

  // 設定
  getSettings(): Settings {
    const r = this.db.prepare(`select data from settings where key = 'main'`).get();
    const base = defaultSettings();
    if (!r) return base;
    const saved = parse<Partial<Settings>>(r);
    // 「あなた」を置く前は、自分で作ったプレイヤーを使っていた。最初の1人を「あなた」にする
    const own = saved.you ? undefined : this.players.list()[0];
    const you = saved.you ?? (own ? { name: own.name, sex: own.sex } : base.you);
    return { ...base, ...saved, you, ...migrateImage(saved, base), sampling: { ...base.sampling, ...(saved.sampling ?? {}) }, site: { ...base.site, ...(saved.site ?? {}) } };
  }
  putSettings(s: Settings): Settings {
    this.db
      .prepare(`insert into settings (key, data) values ('main', ?) on conflict(key) do update set data = excluded.data`)
      .run(JSON.stringify(s));
    return s;
  }

  // チャット
  listChats(plotId?: string): Chat[] {
    const rows = plotId
      ? this.db.prepare('select data from chats where plot_id = ? order by updated_at desc').all(plotId)
      : this.db.prepare('select data from chats order by updated_at desc').all();
    return rows.map((r) => parse<Chat>(r));
  }
  getChat(id: string): Chat | undefined {
    const r = this.db.prepare('select data from chats where id = ?').get(id);
    return r ? parse<Chat>(r) : undefined;
  }
  putChat(chat: Chat): Chat {
    chat.updatedAt = Date.now();
    this.db
      .prepare('insert into chats (id, plot_id, data, updated_at) values (?, ?, ?, ?) on conflict(id) do update set data = excluded.data, updated_at = excluded.updated_at')
      .run(chat.id, chat.plotId, JSON.stringify(chat), chat.updatedAt);
    return chat;
  }
  deleteChat(id: string): void {
    this.tx(() => {
      this.db.prepare('delete from messages where chat_id = ?').run(id);
      this.db.prepare('delete from summaries where chat_id = ?').run(id);
      this.db.prepare('delete from chats where id = ?').run(id);
    });
  }

  // メッセージ
  listMessages(chatId: string): Message[] {
    return this.db
      .prepare('select data from messages where chat_id = ? order by seq')
      .all(chatId)
      .map((r) => parse<Message>(r));
  }
  getMessage(id: string): Message | undefined {
    const r = this.db.prepare('select data from messages where id = ?').get(id);
    return r ? parse<Message>(r) : undefined;
  }
  addMessage(m: Message): Message {
    const r = this.db.prepare('select coalesce(max(seq), 0) as s from messages where chat_id = ?').get(m.chatId) as { s: number };
    this.db.prepare('insert into messages (id, chat_id, seq, data) values (?, ?, ?, ?)').run(m.id, m.chatId, r.s + 1, JSON.stringify(m));
    return m;
  }
  putMessage(m: Message): Message {
    this.db.prepare('update messages set data = ? where id = ?').run(JSON.stringify(m), m.id);
    return m;
  }
  deleteMessage(id: string): void {
    this.db.prepare('delete from messages where id = ?').run(id);
  }

  // 要約
  listSummaries(chatId: string): Summary[] {
    return this.db
      .prepare('select data from summaries where chat_id = ?')
      .all(chatId)
      .map((r) => parse<Summary>(r))
      .sort((a, b) => a.createdAt - b.createdAt);
  }
  putSummary(s: Summary): Summary {
    this.db
      .prepare('insert into summaries (id, chat_id, data) values (?, ?, ?) on conflict(id) do update set data = excluded.data')
      .run(s.id, s.chatId, JSON.stringify(s));
    return s;
  }
  deleteSummary(id: string): void {
    this.db.prepare('delete from summaries where id = ?').run(id);
  }

  // シナリオを手順で作るときの候補。表は前の「作成の相談」のものを使い、古い形の中身は空として読む。
  // キャラの組み合わせと主人公の候補は、1人ずつ作る形に変えたので読まない
  getWizard(plotId: string): PlotWizard {
    const r = this.db.prepare('select data from assist_threads where plot_id = ?').get(plotId);
    const w = r ? parse<Partial<PlotWizard>>(r) : undefined;
    if (!w?.steps) return emptyWizard(plotId);
    const steps: PlotWizard['steps'] = {};
    if (w.steps.story) steps.story = w.steps.story;
    if (w.steps.intro) steps.intro = w.steps.intro;
    return { ...emptyWizard(plotId), ...w, plotId, steps };
  }
  putWizard(w: PlotWizard): PlotWizard {
    this.db
      .prepare('insert into assist_threads (plot_id, data) values (?, ?) on conflict(plot_id) do update set data = excluded.data')
      .run(w.plotId, JSON.stringify(w));
    return w;
  }

  deletePlot(id: string): void {
    this.tx(() => {
      for (const c of this.listChats(id)) {
        this.db.prepare('delete from messages where chat_id = ?').run(c.id);
        this.db.prepare('delete from summaries where chat_id = ?').run(c.id);
      }
      this.db.prepare('delete from chats where plot_id = ?').run(id);
      this.db.prepare('delete from assist_threads where plot_id = ?').run(id);
      this.db.prepare('delete from plots where id = ?').run(id);
    });
  }
}

// 前の画像プロフィールは「タグのみ（SDXL系）」とレーティングごとのネガティブを持ち、モデルはComfyUIの設定に1つだけだった。
// Animaの版ごとのプリセットに置き換え、選んでいたモデルは選んでいたプリセットへ移す
function migrateImage(saved: Partial<Settings>, base: Settings): Pick<Settings, 'imageProfiles' | 'imageProfileId' | 'comfy'> {
  const comfy = { ...base.comfy, ...(saved.comfy ?? {}) } as Settings['comfy'] & { model?: string; freeAfterImage?: boolean };
  const model = comfy.model;
  delete comfy.model;
  delete comfy.freeAfterImage;
  const old = saved.imageProfiles ?? [];
  if (old.length && old.every((p) => typeof p.steps === 'number')) return { imageProfiles: old, imageProfileId: saved.imageProfileId ?? base.imageProfileId, comfy };
  const profiles = structuredClone(base.imageProfiles);
  const aesthetic = profiles.find((p) => p.id === 'anima') as ImageProfile;
  const oldAnima = old.find((p) => p.id === 'anima');
  if (oldAnima) Object.assign(aesthetic, { qualityTags: oldAnima.qualityTags, negative: oldAnima.negative });
  for (const p of old) {
    if (p.id !== 'anima' && p.id !== 'tags') profiles.push({ ...aesthetic, id: p.id, name: p.name, qualityTags: p.qualityTags, negative: p.negative });
  }
  const id = profiles.some((p) => p.id === saved.imageProfileId) ? (saved.imageProfileId as string) : 'anima';
  if (model) (profiles.find((p) => p.id === id) as ImageProfile).model = model;
  return { imageProfiles: profiles, imageProfileId: id, comfy };
}
