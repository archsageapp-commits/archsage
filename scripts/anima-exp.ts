// 実験用: JSON（neg, seeds, variants）のプロンプトを同じシードで描き、data/dev/images/exp/ に保存する
// 使い方: node scripts/anima-exp.ts 実験.json
// JSON に model、steps、cfg、sampler、scheduler があれば、ワークフローの値の代わりに使う
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fillWorkflow, runComfy } from '../server/src/comfy.ts';
import { ANIMA_NODE_MAP } from '../shared/src/defaults.ts';
const w = JSON.parse(readFileSync('assets/workflows/anima.json', 'utf8'));
const set = JSON.parse(readFileSync(process.argv[2], 'utf8')) as {
  neg: string;
  seeds: number[];
  variants: Record<string, string>;
  model?: string;
  steps?: number;
  cfg?: number;
  sampler?: string;
  scheduler?: string;
};
mkdirSync('data/dev/images/exp', { recursive: true });
const { model, steps, cfg, sampler, scheduler } = set;
for (const [k, positive] of Object.entries(set.variants)) for (const seed of set.seeds) {
  const out = `data/dev/images/exp/${k}-${seed}.png`;
  if (existsSync(out)) continue;
  const r = await runComfy('http://127.0.0.1:8188', fillWorkflow(w, ANIMA_NODE_MAP, { positive, negative: set.neg, seed, width: 1024, height: 1536, model, steps, cfg, sampler, scheduler }) as never, () => undefined);
  writeFileSync(out, r.data);
  console.log(out);
}
console.log('ok');
