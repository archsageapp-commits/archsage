import { createServer, type Server } from 'node:http';

// テストと手元の確認用の、OpenAI互換のにせのLLM。スキーマの名前を見て形の合う返答を作る

export interface MockCall {
  body: { model: string; max_tokens?: number; stream?: boolean; messages: { role: string; content: string }[]; response_format?: { json_schema?: { name: string; schema: { properties: Record<string, unknown> } } } };
}

function speakersFrom(system: string): string[] {
  const m = /話せる人（([^）]*)）/.exec(system);
  if (!m || m[1] === 'なし') return [];
  return m[1].split('、').filter(Boolean);
}

// シナリオを手順で作るときの候補。turn を混ぜて、出し直すと中身が変わるようにする
function mockWizard(step: string, turn: number, last: string): unknown {
  const three = <T,>(f: (i: number) => T) => ({ candidates: [0, 1, 2].map(f) });
  const outfit = [{ slot: 'top', item: 'white shirt', itemJa: '白いシャツ' }, { slot: 'nope', item: 'x', itemJa: 'x' }];
  // 決まっていることに並んだキャラの名前
  const names = [...last.matchAll(/^- ([^:\n]+): /gm)].map((m) => m[1]);
  if (step === 'story') return three((i) => ({ pitch: `案${i + 1}-${turn}`, title: `題名${i + 1}`, story: `物語${i + 1}`, playerPosition: '{{user}}は転校生' }));
  if (step === 'character') return { name: `キャラ${turn}`, sex: 'female', profile: `明るい（${turn}）`, appearanceText: 'a girl', outfit };
  if (step === 'player') return { name: `ユウ${turn}`, sex: 'male', profile: '2年生', appearanceText: 'a boy', outfit };
  if (step === 'intro') {
    const present = (/この場面にいるキャラ: ([^（\n]+)/.exec(last)?.[1] ?? '').split('、').filter(Boolean);
    return three((i) => ({ pitch: `場面${i + 1}`, text: `${present[0] ?? ''}「おはよう」（${i}）`, present, location: '教室', locationTags: 'classroom, indoors', time: '朝', weather: '晴れ' }));
  }
  if (step === 'illust') {
    return { people: [...names, '{{user}}'].map((n) => ({ name: n, sex: 'female', appearanceText: 'a person', outfit })) };
  }
  return { tagline: '一言', intro: '紹介', hashtags: ['#学園', '日常'], examples: '{{user}}「やあ」\nあおい0「おはよう」' };
}

export function mockReply(call: MockCall, turn: number): string {
  const rf = call.body.response_format?.json_schema;
  const system = call.body.messages[0]?.content ?? '';
  const last = call.body.messages[call.body.messages.length - 1]?.content ?? '';
  const name = rf?.name ?? (/あらすじ/.test(system) ? 'summary' : /挿絵/.test(system) ? 'illustration' : 'reply');
  if (name === 'illustration') {
    return JSON.stringify({
      outfits: turn % 2 === 0 ? [] : [{ person: (/^- ([^:（]+)/m.exec(last)?.[1] ?? '').trim(), slot: 'outerwear', item: 'blazer', worn: false, state: '', itemJa: 'ブレザー', stateJa: '' }],
      location: { name: '教室', tags: 'classroom, indoors, desk, window, chalkboard' },
      pose: { changed: true, position: 'standing', contacts: [] },
      framing: 'cowboy shot',
      action: 'smile, looking at viewer, waving',
      scene: (() => { const drawn = (/# 描く人\n([^\n]*)/.exec(last)?.[1] ?? '').split('、').filter((n) => n && !n.startsWith('（')); return drawn.length ? `${drawn.map((n) => `{${n}}`).join(' and ')} greet each other in an empty classroom after school.` : 'An empty classroom after school.'; })(),
      positions: [],
    });
  }
  if (name.startsWith('wizard_')) return JSON.stringify(mockWizard(name.slice(7), turn, last));
  if (name === 'summary' || !rf) {
    if (/JSON/.test(system) && /返答/.test(system)) {
      // スキーマなしのチャット
      return '```json\n' + JSON.stringify({ narration_0: '（スキーマなし）', speaker_0: '', line_0: '', narration_1: '', present: [], location: '', time: '', weather: '', changes: '' }) + '\n```';
    }
    return `あらすじ${turn}: 二人は放課後の教室で出会い、友達になった。`;
  }
  const props = rf.schema.properties;
  const speakers = speakersFrom(system);
  const base = { present: speakers, location: '教室', time: '夕方', weather: '晴れ', changes: turn % 3 === 0 ? `${speakers[0] ?? ''}: 上着を脱いだ` : '' };
  if ('parts' in props) {
    return JSON.stringify({
      parts: [
        { kind: 'narration', speaker: '', text: `夕日が差しこむ。（${turn}回目）` },
        ...speakers.map((s) => ({ kind: 'line', speaker: s, text: `${s}です。よろしくね。` })),
      ],
      ...base,
    });
  }
  const out: Record<string, unknown> = { ...base };
  const slots = Object.keys(props).filter((k) => k.startsWith('speaker_')).length;
  for (let i = 0; i < slots; i++) {
    out[`narration_${i}`] = i === 0 ? `夕日が差しこむ教室。（${turn}回目）` : '';
    out[`speaker_${i}`] = speakers[i] ?? '';
    out[`line_${i}`] = speakers[i] ? `${speakers[i]}だよ。今日はどうしたの？` : '';
  }
  out[`narration_${slots}`] = '窓の外で鳥が鳴いた。';
  return JSON.stringify(out);
}

// stream を頼まれたら、返答を細かく分けて SSE で送る。delayMs で送る間隔を空けられる
export interface MockStream {
  delayMs: number;
  chunksSent: number;
}

export function startMockLlm(port = 0): Promise<{ server: Server; url: string; calls: MockCall[]; stream: MockStream }> {
  const calls: MockCall[] = [];
  const stream: MockStream = { delayMs: 0, chunksSent: 0 };
  const server = createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'mock-chat' }, { id: 'mock-util' }] }));
        return;
      }
      const body = JSON.parse(data || '{}');
      const call: MockCall = { body };
      calls.push(call);
      const content = mockReply(call, calls.length);
      if (body.stream) {
        void (async () => {
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          for (let i = 0; i < content.length && !res.destroyed; i += 20) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: content.slice(i, i + 20) } }] })}\n\n`);
            stream.chunksSent++;
            if (stream.delayMs) await new Promise((r) => setTimeout(r, stream.delayMs));
          }
          res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
          res.end('data: [DONE]\n\n');
        })();
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      const p = typeof addr === 'object' && addr ? addr.port : port;
      resolve({ server, url: `http://127.0.0.1:${p}/v1`, calls, stream });
    });
  });
}
