import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApp } from '../src/app.ts';
import { startMockLlm } from './mockLlm.ts';
import { strToU8, zipSync } from 'fflate';
import { BUNDLE_FORMAT, BUNDLE_VERSION, packBundle, unpackBundle, type Message, type Player, type PlayerRef, type Plot, type PlotWizard, type Settings } from '@archsage/shared';

const dataDir = mkdtempSync(join(tmpdir(), 'archsage-test-'));
const root = resolve(import.meta.dirname, '..', '..');
const ctx = createApp({ paths: { dataDir, webDir: join(root, 'web', 'dist'), assetsDir: join(root, 'assets') } });
const mock = await startMockLlm();

after(() => {
  mock.server.close();
  ctx.db.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await ctx.app.request(`/api${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

let plot: Plot;

test('設定: APIキーは画面に返さず、設定済みかどうかだけ返す', async () => {
  const s = await call<Settings>('PUT', '/settings', {
    connections: [{ id: 'mock', name: 'mock', kind: 'openai', baseUrl: mock.url, apiKey: 'secret', structuredOutputs: true }],
    chatModel: { connectionId: 'mock', model: 'mock-chat' },
    comfy: { url: 'http://127.0.0.1:1' },
  });
  assert.equal(s.connections[0].apiKey, undefined);
  assert.equal(s.connections[0].hasApiKey, true);
  // キーを送らなければ前のまま
  const s2 = await call<Settings>('PUT', '/settings', { connections: [{ ...s.connections[0], name: 'mock2' }] });
  assert.equal(s2.connections[0].hasApiKey, true);
  assert.equal(ctx.store.getSettings().connections[0].apiKey, 'secret');
  const models = await call<{ models: string[] }>('POST', '/connections/models', { id: 'mock', kind: 'openai', baseUrl: mock.url });
  assert.deepEqual(models.models, ['mock-chat', 'mock-util']);
});

test('設定: 前の画像プロフィールはAnimaのプリセットに置き換え、選んでいたモデルを移す', () => {
  const now = ctx.store.getSettings();
  const old = {
    ...now,
    imageProfileId: 'anima',
    imageProfiles: [
      { id: 'anima', name: 'Anima', qualityTags: 'masterpiece', negative: 'bad', naturalLanguage: true, safetyNegatives: { safe: 'nsfw', sensitive: '', nsfw: '', explicit: '' } },
      { id: 'tags', name: 'タグのみ（SDXL系）', qualityTags: 'x', negative: 'y', naturalLanguage: false, safetyNegatives: { safe: '', sensitive: '', nsfw: '', explicit: '' } },
      { id: 'mine', name: '自分の', qualityTags: 'q', negative: 'n', naturalLanguage: true, safetyNegatives: { safe: '', sensitive: '', nsfw: '', explicit: '' } },
    ],
    comfy: { ...now.comfy, model: 'my-anima.safetensors', freeAfterImage: true },
  };
  ctx.store.putSettings(old as unknown as Settings);
  const s = ctx.store.getSettings();
  assert.deepEqual(s.imageProfiles.map((p) => p.id), ['anima-base', 'anima', 'anima-turbo', 'mine']);
  const aesthetic = s.imageProfiles[1];
  assert.deepEqual([aesthetic.model, aesthetic.qualityTags, aesthetic.negative, aesthetic.steps], ['my-anima.safetensors', 'masterpiece', 'bad', 30]);
  assert.equal(s.imageProfiles[2].cfg, 1);
  assert.equal(s.imageProfiles[3].steps, 30);
  assert.deepEqual(s.comfy.loras, []);
  assert.ok(!('safetyNegatives' in aesthetic));
  assert.ok(!('model' in s.comfy) && !('freeAfterImage' in s.comfy));
  ctx.store.putSettings(s);
  assert.deepEqual(ctx.store.getSettings().imageProfiles, s.imageProfiles);
});

test('プロットを作って保存する', async () => {
  plot = await call<Plot>('POST', '/plots', { title: '放課後' });
  plot.story = '放課後の教室。';
  plot.characters = [
    {
      id: 'hinata',
      name: 'ひなた',
      profile: '明るい同級生。',
      illust: {
        sex: 'female',
        countTag: '1girl',
        appearanceText: 'a girl with short orange hair',
        defaultOutfit: { slots: { outerwear: { item: 'blazer', worn: true, state: '' }, top: { item: 'white shirt', worn: true, state: '' } } },
      },
    },
  ];
  plot.players = [{ id: 'yu', name: 'ユウ', description: '転校生', sex: 'male', countTag: '1boy' }];
  plot.intros = [{ text: 'ひなた「やっほー！」\n夕日が差しこむ。', present: ['hinata'] }];
  plot = await call<Plot>('PUT', `/plots/${plot.id}`, plot);
  assert.equal(plot.characters[0].illust.defaultOutfit.slots.top?.item, 'white shirt');
});

test('チャット: イントロから始め、返答を作り、作り直す', async () => {
  const created = await call<{ chat: { id: string }; messages: Message[] }>('POST', '/chats', { plotId: plot.id, autoIllustrate: false });
  const chatId = created.chat.id;
  assert.equal(created.messages.length, 1);
  assert.deepEqual(created.messages[0].swipes[0].parts?.[0], { kind: 'line', speaker: 'hinata', text: 'やっほー！' });

  const preview = await call<{ messages: { role: string; content: string }[] }>('POST', `/chats/${chatId}/preview`, { text: 'やあ', instruction: '夜にして' });
  assert.ok(preview.messages[preview.messages.length - 1].content.includes('次の返答への指示: 夜にして'));

  const r = await call<{ message: Message; messages: Message[] }>('POST', `/chats/${chatId}/generate`, { text: 'やあ', instruction: '夜にして' });
  assert.equal(r.messages.length, 3);
  const reply = r.message.swipes[0];
  assert.equal(reply.error, undefined, reply.error);
  assert.ok(reply.parts?.some((p) => p.kind === 'line' && p.speaker === 'hinata'));
  assert.equal(reply.state?.location?.name, '教室');
  assert.equal(reply.state?.time, '夕方');
  const sent = mock.calls[mock.calls.length - 1].body;
  assert.equal(sent.response_format?.json_schema?.name, 'reply');
  assert.ok(sent.messages[sent.messages.length - 1].content.includes('夜にして'));

  const again = await call<{ message: Message }>('POST', `/chats/${chatId}/generate`, { regenerate: true });
  assert.equal(again.message.swipes.length, 2);
  assert.equal(again.message.activeSwipe, 1);
  // 作り直しでも、利用者の発言に付けた指示はもう一度付ける
  const sent2 = mock.calls[mock.calls.length - 1].body;
  assert.ok(sent2.messages[sent2.messages.length - 1].content.includes('夜にして'));

  // 指示を直すと、作り直しで直した指示を付ける
  const asked = await call<{ messages: Message[] }>('PATCH', `/chats/${chatId}/messages/${r.messages[1].id}`, { text: 'やあ', instruction: '朝にして' });
  assert.equal(asked.messages[1].swipes[0].instruction, '朝にして');
  await call('POST', `/chats/${chatId}/generate`, { regenerate: true });
  const sent3 = mock.calls[mock.calls.length - 1].body.messages;
  assert.ok(sent3[sent3.length - 1].content.includes('朝にして') && !sent3[sent3.length - 1].content.includes('夜にして'));

  // 編集とスワイプの切り替え
  const edited = await call<{ messages: Message[] }>('PATCH', `/chats/${chatId}/messages/${again.message.id}`, { activeSwipe: 0, text: 'ひなた「書き換えた」' });
  const m = edited.messages[2];
  assert.equal(m.activeSwipe, 0);
  assert.deepEqual(m.swipes[0].parts, [{ kind: 'line', speaker: 'hinata', text: '書き換えた' }]);

  // 手で直すと、その欄を毎回送る（物語の中で変わるまで）
  const state = structuredClone(m.swipes[0].state!);
  state.outfits.hinata.slots.outerwear = { item: 'blazer', worn: false, state: '' };
  await call('PATCH', `/chats/${chatId}/messages/${m.id}`, { state });
  const fixed = '利用者が決めた状況（これに合わせる）: ひなたの上着は着ていない';
  const p2 = await call<{ messages: { content: string }[] }>('POST', `/chats/${chatId}/preview`, { text: '脱いだね' });
  assert.ok(p2.messages[p2.messages.length - 1].content.includes(fixed));
  await call('POST', `/chats/${chatId}/generate`, { text: '脱いだね' });
  const p3 = await call<{ messages: { content: string }[] }>('POST', `/chats/${chatId}/preview`, { text: 'つぎ' });
  assert.ok(p3.messages[p3.messages.length - 1].content.includes(fixed));
});

test('返答は書きながら画面へ送り、途中で止めると書けたところまでを残す', async () => {
  const created = await call<{ chat: { id: string } }>('POST', '/chats', { plotId: plot.id, autoIllustrate: false });
  const chatId = created.chat.id;
  const drafts: number[] = [];
  const off = ctx.core.hub.subscribe((e) => {
    if (e.type === 'draft' && e.chatId === chatId) drafts.push(e.parts.length);
  });
  try {
    // 最後まで書くと、途中の表示も送っている
    mock.stream.delayMs = 25;
    const done = await call<{ message: Message }>('POST', `/chats/${chatId}/generate`, { text: 'おはよう' });
    assert.ok(drafts.length > 0);
    assert.ok(!done.message.swipes[0].stopped);

    // 途中で止める。本文が1つ届くまで待つ（返答の前に状況の欄が長く続くこともある）
    drafts.length = 0;
    mock.stream.delayMs = 40;
    const pending = call<{ message: Message | null; messages: Message[] }>('POST', `/chats/${chatId}/generate`, { text: 'それで？' });
    while (!drafts.some((n) => n > 0)) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(await call('POST', `/chats/${chatId}/stop`), { stopped: true });
    const r = await pending;
    const sw = r.message!.swipes[0];
    assert.equal(sw.stopped, true);
    assert.ok((sw.parts?.length ?? 0) > 0);
    // 場面の状態は前の返答のまま
    assert.deepEqual(sw.state, done.message.swipes[0].state);
    assert.deepEqual(await call('POST', `/chats/${chatId}/stop`), { stopped: false });
  } finally {
    off();
    mock.stream.delayMs = 0;
  }
});

test('「あなた」として遊ぶ: シナリオの主人公の名前だけを「あなた」にし、顔は描かない', async () => {
  await call('PUT', '/settings', { you: { name: 'ミナ', sex: 'female' } });
  const p = await call<Plot>('POST', '/plots', { title: '学園' });
  p.players = [{ id: 'hero', name: '海斗', description: '転校生', sex: 'male', countTag: '1boy', appearanceText: 'a boy with black hair', defaultOutfit: { slots: { top: { item: 'blazer', worn: true, state: '' } } } }];
  await call('PUT', `/plots/${p.id}`, p);
  // 性別、立場、服装はシナリオの主人公のまま
  const a = await call<{ chat: { player: PlayerRef }; player: Player }>('POST', '/chats', { plotId: p.id, autoIllustrate: false, player: { source: 'plot', id: 'hero', asYou: true } });
  assert.deepEqual([a.player.name, a.player.sex, a.player.description, a.player.appearanceText, a.player.defaultOutfit?.slots.top?.item], ['ミナ', 'male', '転校生', 'faceless male, a boy with black hair', 'blazer']);
  // 選ばなければ、シナリオの主人公のまま
  const b = await call<{ player: Player }>('POST', '/chats', { plotId: p.id, autoIllustrate: false, player: { source: 'plot', id: 'hero' } });
  assert.equal(b.player.name, '海斗');

  // 主人公のいないシナリオは「あなた」で遊ぶ
  const empty = await call<Plot>('POST', '/plots', { title: '主人公なし' });
  const v = await call<{ chat: { player: PlayerRef }; player: Player }>('POST', '/chats', { plotId: empty.id, autoIllustrate: false });
  assert.deepEqual(v.chat.player, { source: 'you', id: 'you' });
  assert.deepEqual([v.player.name, v.player.appearanceText], ['ミナ', 'faceless female']);
});

test('前のスワイプを消すと、見ている返答はそのまま', async () => {
  const created = await call<{ chat: { id: string } }>('POST', '/chats', { plotId: plot.id, autoIllustrate: false });
  const chatId = created.chat.id;
  await call('POST', `/chats/${chatId}/generate`, { text: 'a' });
  await call('POST', `/chats/${chatId}/generate`, { regenerate: true });
  const r = await call<{ message: Message }>('POST', `/chats/${chatId}/generate`, { regenerate: true });
  assert.equal(r.message.activeSwipe, 2);
  const keep = r.message.swipes[2].text;
  const v = await call<{ messages: Message[] }>('DELETE', `/chats/${chatId}/messages/${r.message.id}?swipe=0`);
  const m = v.messages[v.messages.length - 1];
  assert.equal(m.swipes.length, 2);
  assert.equal(m.activeSwipe, 1);
  assert.equal(m.swipes[m.activeSwipe].text, keep);
});

test('シナリオを手順で作る: 筋書きと導入は候補から選び、キャラと主人公は1人ずつ作る。選び直しても、ほかの段は残る', async () => {
  const p = await call<Plot>('POST', '/plots', { title: '' });
  const base = `/plots/${p.id}/wizard`;
  await assert.rejects(call('POST', `${base}/story`, {}), /コンセプト/);
  await call('PUT', base, { concept: '学園もの' });
  const before = mock.calls.length;
  let w = await call<PlotWizard>('POST', `${base}/story`, {});
  assert.equal(w.steps.story?.candidates.length, 3);
  assert.equal(mock.calls[before].body.max_tokens, 8192);
  assert.match(mock.calls[before].body.messages[1].content, /学園もの/);

  // 画面で直した候補をそのまま入れる
  let r = await call<{ plot: Plot; wizard: PlotWizard }>('POST', `${base}/story/choose`, { index: 1, candidate: { ...w.steps.story!.candidates[1], title: '直した題名' } });
  assert.equal(r.plot.title, '直した題名');
  assert.equal(r.plot.story, '物語2');

  // キャラは1人ずつ足す。見た目のタグと服装も一緒に入る
  let pr = await call<{ plot: Plot; wizard: PlotWizard; id: string }>('POST', `${base}/person/new`, { request: '年上の先輩' });
  assert.match(mock.calls[mock.calls.length - 1].body.messages[1].content, /直した題名[\s\S]*年上の先輩/);
  const first = pr.plot.characters[0];
  assert.equal(pr.id, first.id);
  assert.equal(first.illust.appearanceText, 'a girl');
  assert.deepEqual(Object.keys(first.illust.defaultOutfit.slots), ['top']);
  pr = await call('POST', `${base}/person/new`, {});
  assert.match(mock.calls[mock.calls.length - 1].body.messages[1].content, new RegExp(`すでにいるキャラ:\\n- ${first.name}: `));
  const second = pr.plot.characters[1];
  assert.equal(pr.plot.characters.length, 2);

  // 1人だけ作り直す。id はそのままで、前の中身に戻せる
  pr = await call('POST', `${base}/person/${first.id}`, { request: 'もっと静かに' });
  const sent = mock.calls[mock.calls.length - 1].body.messages[1].content;
  assert.ok(sent.includes(`名前: ${first.name}`) && sent.includes('もっと静かに') && sent.includes(`- ${second.name}: `));
  assert.equal(pr.plot.characters[0].id, first.id);
  assert.notEqual(pr.plot.characters[0].name, first.name);
  assert.equal(pr.plot.characters[1].name, second.name);
  r = await call('POST', `${base}/person/${first.id}/undo`);
  assert.equal(r.plot.characters[0].name, first.name);
  assert.equal(r.wizard.previous?.[first.id], undefined);
  await assert.rejects(call('POST', `${base}/person/${first.id}/undo`), /戻せる/);

  pr = await call('POST', `${base}/person/player`, {});
  assert.match(pr.plot.players[0].name, /^ユウ/);
  assert.equal(pr.plot.players[0].appearanceText, 'a boy');

  // 導入は、場面に出すキャラを選んでから候補を出す
  w = await call<PlotWizard>('POST', `${base}/intro`, { present: [second.id, 'nope'] });
  assert.deepEqual(w.present, [second.id]);
  assert.match(mock.calls[mock.calls.length - 1].body.messages[1].content, new RegExp(`この場面にいるキャラ: ${second.name}（`));
  r = await call('POST', `${base}/intro/choose`, { index: 0, candidate: w.steps.intro!.candidates[0] });
  assert.deepEqual(r.plot.intros[0].present, [second.id]);
  assert.equal(r.plot.intros[0].location?.tags, 'classroom, indoors');
  r = await call('POST', `${base}/intro/choose`, { index: 1, candidate: w.steps.intro!.candidates[1], mode: 'add' });
  assert.equal(r.plot.intros.length, 2);

  // 筋書きを選び直しても、キャラと導入は残る
  r = await call('POST', `${base}/story/choose`, { index: 0, candidate: r.wizard.steps.story!.candidates[0] });
  assert.ok(r.wizard.steps.intro);
  assert.equal(r.plot.characters.length, 2);
  assert.equal(r.plot.intros.length, 2);

  // 見た目を試す。ComfyUI の代わりに、決まった絵を返す
  const core = ctx.core as unknown as { renderPlotImage: (plotId: string, kind: string) => Promise<string> };
  const orig = core.renderPlotImage;
  let n = 0;
  core.renderPlotImage = async (plotId, kind) => {
    const rel = `plots/${plotId}/${kind}-t${++n}.png`;
    ctx.core.saveImage(rel, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    return rel;
  };
  try {
    r = await call('POST', `${base}/person/${second.id}/try`, { kind: 'full' });
    assert.match(r.plot.characters[1].fullBody ?? '', /full-t1/);
    r = await call('POST', `${base}/person/${second.id}/try`, { kind: 'bust' });
    const bust = r.wizard.tries![second.id].find((t) => t.kind === 'bust')!;
    // アイコンがまだなければ、描いたバストアップがそのままアイコンになる
    assert.equal(r.plot.characters[1].avatar, bust.file);
    r = await call('POST', `${base}/person/${second.id}/try`, { kind: 'bust' });
    assert.equal(r.plot.characters[1].avatar, bust.file);
    const next = r.wizard.tries![second.id].at(-1)!;
    const iconed = await call<Plot>('POST', `${base}/person/${second.id}/icon`, { file: next.file });
    assert.equal(iconed.characters[1].avatar, next.file);
    await assert.rejects(call('POST', `${base}/person/${second.id}/icon`, { file: 'plots/x/y.png' }), /見つかりません/);

    // サムネイルは注文を添えて描ける。まだなければ最初の絵を使い、あとから選び直せる
    r = await call('POST', `${base}/cover`, { request: '灯台の前で、2人がコーヒーを飲む' });
    const firstCover = r.plot.listing.cover;
    assert.match(firstCover ?? '', /cover-t/);
    assert.equal(r.wizard.coverRequest, '灯台の前で、2人がコーヒーを飲む');
    const illustCall = [...mock.calls].reverse().find((c) => c.body.response_format?.json_schema?.name === 'illustration')!;
    assert.match(illustCall.body.messages.at(-1)!.content, /利用者からの注文（これを優先する）\n灯台の前で/);
    r = await call('POST', `${base}/cover`, {});
    assert.equal(r.plot.listing.cover, firstCover);
    const covers = r.wizard.tries!.cover;
    assert.equal(covers.length, 2);
    assert.equal((await call<Plot>('POST', `${base}/cover/use`, { file: covers[1].file })).listing.cover, covers[1].file);
    // 描く人を選べる。主人公も入れるかを選べる
    const drawnLine = () => /# 描く人\n([^\n]*)/.exec([...mock.calls].reverse().find((c) => c.body.response_format?.json_schema?.name === 'illustration')!.body.messages.at(-1)!.content)?.[1];
    r = await call('POST', `${base}/cover`, { present: [second.id], player: false });
    assert.equal(drawnLine(), second.name);
    assert.deepEqual([r.wizard.coverPresent, r.wizard.coverPlayer], [[second.id], false]);
    await call('POST', `${base}/cover`, { present: [first.id], player: true });
    assert.equal(drawnLine(), `${first.name}、${r.plot.players[0].name}`);
    await assert.rejects(call('POST', `${base}/cover`, { present: [], player: false }), /1人以上/);
  } finally {
    core.renderPlotImage = orig;
  }
  // 書き出しには立ち絵を入れない
  const zip = new Uint8Array(await (await ctx.app.request(`/api/plots/${p.id}/export`)).arrayBuffer());
  const { json } = unpackBundle(zip);
  assert.equal(json.plot.characters[1].fullBody, undefined);

  // 1人を外すと、導入の場面からも外れる
  r = await call('DELETE', `${base}/person/${second.id}`);
  assert.deepEqual(r.plot.characters.map((c) => c.id), [first.id]);
  assert.deepEqual(r.plot.intros[0].present, []);
  assert.deepEqual(r.wizard.present, []);

  // 仕上げ: みんな見た目が決まっているので、紹介だけを作る
  const atFinish = mock.calls.length;
  r = await call('POST', `${base}/finish`);
  assert.equal(r.wizard.finished, true);
  assert.deepEqual(mock.calls.slice(atFinish).map((c) => c.body.response_format?.json_schema?.name), ['wizard_listing']);
  assert.deepEqual(r.plot.listing.hashtags, ['学園', '日常']);
  assert.match(r.plot.examples, /おはよう/);
  await assert.rejects(call('POST', `${base}/cast`, {}), /段が違います/);
});

test('書き出したzipを取り込むと、別のプロットとして入る', async () => {
  const book = await call<{ id: string }>('POST', '/lorebooks', { name: '学園', entries: [{ keys: ['教室'], content: '3階' }] });
  plot.lorebookIds = [book.id];
  await call('PUT', `/plots/${plot.id}`, plot);
  const res = await ctx.app.request(`/api/plots/${plot.id}/export`);
  assert.equal(res.headers.get('content-type'), 'application/zip');
  const zip = new Uint8Array(await res.arrayBuffer());
  const imported = await call<Plot>('POST', '/plots/import', zip);
  assert.notEqual(imported.id, plot.id);
  assert.equal(imported.title, '放課後');
  assert.equal(imported.lorebookIds.length, 1);
  assert.notEqual(imported.lorebookIds[0], book.id);
});

// CRCは確かめないので0で埋める
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(data, 8);
  return out;
}
const testPng = (() => {
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', new Uint8Array(13)), pngChunk('tEXt', new TextEncoder().encode('prompt\0{"secret":"lora"}')), pngChunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
})();

test('書き出しでは画像に埋め込まれた生成の設定を消し、投稿の印は取り込むと出どころになる', async () => {
  const ref = { site: 'https://site.example', postId: 'p1', authorId: 'u1', authorName: '作者', title: '放課後' };
  await call('PUT', `/plots/${plot.id}`, { ...plot, posted: ref, listing: { ...plot.listing, sourceTitle: '元の作品' } });
  const up = await ctx.app.request(`/api/plots/${plot.id}/upload?kind=cover`, { method: 'POST', headers: { 'content-type': 'image/png' }, body: testPng });
  assert.equal(up.status, 200);
  const zip = new Uint8Array(await (await ctx.app.request(`/api/plots/${plot.id}/export`)).arrayBuffer());
  const { json, images } = unpackBundle(zip);
  assert.deepEqual(json.plot.posted, ref);
  const cover = images[json.plot.listing.cover!];
  assert.ok(cover);
  assert.equal(new TextDecoder().decode(cover).includes('secret'), false);
  assert.equal(new TextDecoder().decode(cover).includes('IHDR'), true);

  const imported = await call<Plot>('POST', '/plots/import', zip);
  assert.equal(imported.posted, undefined);
  assert.deepEqual(imported.origin, ref);
  assert.equal(imported.listing.sourceTitle, '元の作品');
  const copy = await call<Plot>('POST', `/plots/${plot.id}/duplicate`);
  assert.equal(copy.posted, undefined);
  assert.deepEqual(copy.origin, ref);
});

test('取り込み: 知らないファイルやキャラクターのidで、データフォルダの外に書かせない', async () => {
  const evil = structuredClone(plot);
  evil.characters = [{ ...evil.characters[0], id: '../../../evil', avatar: 'images/a.png' }];
  const json = { format: BUNDLE_FORMAT, version: BUNDLE_VERSION, exportedAt: 0, plot: evil, lorebooks: [] };
  const imported = await call<Plot>('POST', '/plots/import', packBundle(json, { 'images/a.png': testPng }));
  assert.match(imported.characters[0].avatar ?? '', /^plots\/[a-z0-9]+\/avatar-evil-[a-z0-9]+\.png$/);

  const bad = zipSync({ 'plot.json': strToU8(JSON.stringify(json)), '../x.txt': strToU8('x') });
  await assert.rejects(call('POST', '/plots/import', bad), /知らないファイル/);
});

test('ほかのサイトからの書き込みは断る', async () => {
  const res = await ctx.app.request('/api/plots', { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(res.status, 403);
});
