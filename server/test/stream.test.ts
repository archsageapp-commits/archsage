import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connection } from '@archsage/shared';
import { callLlm, LlmError, LlmStopped } from '../src/llm.ts';

// ストリーミングで返すふりをする。hang なら最後まで送らずに待つ
function startFakeStream(pieces: string[], opts: { hang?: boolean; error?: string } = {}): Promise<{ server: Server; url: string }> {
  const server = createServer((req, res) => {
    req.resume();
    req.on('end', async () => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': OPENROUTER PROCESSING\n\n');
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { reasoning: '考え中' } }] })}\n\n`);
      for (const p of pieces) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
        await new Promise((r) => setTimeout(r, 5));
      }
      if (opts.error) {
        res.end(`data: ${JSON.stringify({ error: { message: opts.error } })}\n\n`);
        return;
      }
      if (opts.hang) return;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
      res.end('data: [DONE]\n\n');
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` })));
}

const base = (url: string) => ({
  connection: { id: 'x', name: 'x', kind: 'openai', baseUrl: url, structuredOutputs: false } as Connection,
  model: 'm',
  messages: [{ role: 'user' as const, content: 'hi' }],
  sampling: { temperature: 1, topP: 1, maxTokens: 10 },
});

test('ストリーミング: 届くたびにここまでの全文を渡し、最後に全文と終わり方を返す', async () => {
  const fake = await startFakeStream(['{"narr', 'ation_0": "朝', '。"}']);
  try {
    const seen: string[] = [];
    const res = await callLlm({ ...base(fake.url), onDelta: (t) => seen.push(t) });
    assert.equal(res.text, '{"narration_0": "朝。"}');
    assert.equal(res.reasoning, '考え中');
    assert.equal(res.finishReason, 'stop');
    assert.deepEqual(seen.at(-1), res.text);
    assert.ok(seen.length >= 3);
  } finally {
    fake.server.close();
  }
});

test('ストリーミング: 止めると、それまでに届いた分を持って LlmStopped になる', async () => {
  const fake = await startFakeStream(['{"narration_0": "', '途中まで'], { hang: true });
  const controller = new AbortController();
  try {
    await assert.rejects(
      callLlm({
        ...base(fake.url),
        signal: controller.signal,
        onDelta: (t) => {
          if (t.includes('途中まで')) controller.abort();
        },
      }),
      (e) => e instanceof LlmStopped && e.text === '{"narration_0": "途中まで' && e.reasoning === '考え中',
    );
  } finally {
    fake.server.closeAllConnections();
    fake.server.close();
  }
});

test('ストリーミング: 途中で届いたエラーはエラーにする', async () => {
  const fake = await startFakeStream(['{"a'], { error: 'upstream died' });
  try {
    await assert.rejects(callLlm({ ...base(fake.url), onDelta: () => undefined }), (e) => e instanceof LlmError && !(e instanceof LlmStopped) && /upstream died/.test(e.message));
  } finally {
    fake.server.close();
  }
});
