import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ANIMA_NODE_MAP } from '@archsage/shared';
import { detectNodeMap, fillWorkflow } from '../src/comfy.ts';

const root = resolve(import.meta.dirname, '..', '..');
const anima = JSON.parse(readFileSync(resolve(root, 'assets', 'workflows', 'anima.json'), 'utf8'));

test('同梱のワークフローから探したノードは、決め打ちの対応と同じ', () => {
  assert.deepEqual(detectNodeMap(anima), ANIMA_NODE_MAP);
});

test('モデルはLoRAを挟んでもたどり、選んだときだけ差し替える', () => {
  const w = {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'a.safetensors' } },
    '2': { class_type: 'LoraLoader', inputs: { model: ['1', 0], clip: ['1', 1], lora_name: 'l.safetensors' } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: '', clip: ['2', 1] } },
    '4': { class_type: 'KSampler', inputs: { model: ['2', 0], positive: ['3', 0], seed: 1 } },
  };
  const map = detectNodeMap(w);
  assert.deepEqual(map.model, { node: '1', input: 'ckpt_name' });
  const job = { positive: 'p', negative: '', seed: 2, width: 512, height: 512 };
  assert.equal(fillWorkflow(w, map, job)['1'].inputs?.ckpt_name, 'a.safetensors');
  assert.equal(fillWorkflow(w, map, { ...job, model: 'b.safetensors' })['1'].inputs?.ckpt_name, 'b.safetensors');
});

test('プリセットのステップ数、CFG、サンプラー、スケジューラーをサンプラーのノードに入れる', () => {
  const job = { positive: 'p', negative: 'n', seed: 2, width: 512, height: 512 };
  const kept = fillWorkflow(anima, ANIMA_NODE_MAP, job)['19'].inputs;
  assert.equal(kept?.steps, 30);
  assert.equal(kept?.sampler_name, 'euler');
  const turbo = fillWorkflow(anima, ANIMA_NODE_MAP, { ...job, steps: 10, cfg: 1, sampler: 'er_sde', scheduler: 'simple' })['19'].inputs;
  assert.deepEqual([turbo?.steps, turbo?.cfg, turbo?.sampler_name, turbo?.scheduler], [10, 1, 'er_sde', 'simple']);
});

test('LoRAを入れたワークフローでも、モデルはLoRAの先の読み込みのノードを見つける', () => {
  const lora = JSON.parse(readFileSync(resolve(root, 'ref', 'Anima_LoRA.json'), 'utf8'));
  assert.deepEqual(detectNodeMap(lora), ANIMA_NODE_MAP);
});

test('LoRAはサンプラーの手前に上から順に挟み、名前のないものは飛ばす', () => {
  const job = { positive: 'p', negative: 'n', seed: 2, width: 512, height: 512 };
  const w = fillWorkflow(anima, ANIMA_NODE_MAP, { ...job, loras: [{ name: 'a.safetensors', strength: 0.8 }, { name: ' ', strength: 1 }, { name: 'b.safetensors', strength: 1 }] });
  const added = Object.entries(w).filter(([, n]) => n.class_type === 'LoraLoaderModelOnly');
  assert.equal(added.length, 2);
  const [[aId, a], [bId, b]] = added;
  assert.deepEqual(a.inputs, { lora_name: 'a.safetensors', strength_model: 0.8, model: ['44', 0] });
  assert.deepEqual(b.inputs?.model, [aId, 0]);
  assert.deepEqual(w['19'].inputs?.model, [bId, 0]);
  // 元のワークフローは変えない
  assert.deepEqual(anima['19'].inputs.model, ['44', 0]);
  assert.equal(Object.keys(fillWorkflow(anima, ANIMA_NODE_MAP, { ...job, loras: [] })).length, Object.keys(anima).length);
});
