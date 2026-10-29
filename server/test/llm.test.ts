import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Connection } from '@archsage/shared';
import { callLlm, listProviders } from '../src/llm.ts';

// OpenRouterのふりをする。送られた本文を残し、提供元の一覧を返す
function startFakeRouter(): Promise<{ server: Server; url: string; bodies: Record<string, unknown>[] }> {
  const bodies: Record<string, unknown>[] = [];
  const endpoints = [
    { provider_name: 'Pricey', tag: 'pricey', quantization: 'unknown', pricing: { prompt: '0.0000003', completion: '0.0000012' }, supported_parameters: ['structured_outputs'], status: 0 },
    { provider_name: 'Cheap', tag: 'cheap/fp4', quantization: 'fp4', pricing: { prompt: '0.00000007', completion: '0.0000005' }, supported_parameters: [], status: 0 },
    { provider_name: 'Flaky', tag: 'flaky/fp8', quantization: 'fp8', pricing: { prompt: '0.00000008', completion: '0.0000002' }, supported_parameters: ['structured_outputs'], status: -5 },
  ];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => (raw += d));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/models/acme/model-1/endpoints') return res.end(JSON.stringify({ data: { endpoints } }));
      if (req.url === '/chat/completions') {
        bodies.push(JSON.parse(raw));
        return res.end(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }] }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, bodies })));
}

test('OpenRouterの提供元は入力を重く見た安い順に並び、決めた提供元を先に回す', async () => {
  const fake = await startFakeRouter();
  try {
    const conn: Connection = { id: 'or', name: 'OpenRouter', kind: 'openrouter', baseUrl: fake.url, structuredOutputs: true };
    const list = await listProviders(conn, 'acme/model-1');
    assert.deepEqual(
      list.map((p) => p.tag),
      ['flaky/fp8', 'cheap/fp4', 'pricey'],
    );
    assert.equal(list[1].inputPrice.toFixed(2), '0.07');
    assert.equal(list[1].structuredOutputs, false);
    assert.equal(list[0].down, true);

    const base = { connection: conn, model: 'acme/model-1', messages: [{ role: 'user' as const, content: 'hi' }], sampling: { temperature: 1, topP: 1, maxTokens: 10 } };
    await callLlm({ ...base, provider: { tag: 'cheap/fp4' }, schema: { name: 'x', schema: { type: 'object' } } });
    assert.deepEqual(fake.bodies[0].provider, { require_parameters: true, order: ['cheap/fp4'], allow_fallbacks: true });
    await callLlm({ ...base, provider: { tag: 'cheap/fp4', only: true } });
    assert.deepEqual(fake.bodies[1].provider, { order: ['cheap/fp4'], allow_fallbacks: false });
    await callLlm(base);
    assert.equal(fake.bodies[2].provider, undefined);
    // OpenRouter以外には付けない
    await callLlm({ ...base, connection: { ...conn, kind: 'openai' }, provider: { tag: 'cheap/fp4' } });
    assert.equal(fake.bodies[3].provider, undefined);
  } finally {
    fake.server.close();
  }
});
