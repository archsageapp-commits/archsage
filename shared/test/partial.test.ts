import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftReply, parsePartialJson, parseReply } from '../src/index.ts';

test('書きかけのJSON: 読めたところまでを値にし、途中の文字列は途中まで返す', () => {
  assert.deepEqual(parsePartialJson('{"a": "こんに'), { a: 'こんに' });
  assert.deepEqual(parsePartialJson('{"a": "x", "b": [1, 2, "y'), { a: 'x', b: [1, 2, 'y'] });
  // 途中で切れたキー、数値、true は捨てる
  assert.deepEqual(parsePartialJson('{"a": "x", "lon'), { a: 'x' });
  assert.deepEqual(parsePartialJson('{"a": 12'), {});
  assert.deepEqual(parsePartialJson('{"a": tr'), {});
  assert.deepEqual(parsePartialJson('{"a": true, "b": null}'), { a: true, b: null });
  // エスケープの途中で切れても崩れない
  assert.deepEqual(parsePartialJson('{"a": "改行\\nの後\\'), { a: '改行\nの後' });
  assert.deepEqual(parsePartialJson('{"a": "\\u30'), { a: '' });
  assert.deepEqual(parsePartialJson('{"a": "\\u3042"}'), { a: 'あ' });
  assert.equal(parsePartialJson(''), undefined);
});

test('書きかけの返答: 届いた欄を番号順に吹き出しにし、話し手が来るまでセリフは出さない', () => {
  const resolve = (n: string) => (n === 'ひなた' ? 'c1' : undefined);
  // 欄が並べ替えられて届いても番号順に並べる
  const reordered = '{"changes": "", "line_0": "「おはよ", "narration_0": "朝の光。", "speaker_0": "ひなた", "line_1": "「まだ';
  assert.deepEqual(draftReply(reordered, 'perLine', resolve), [
    { kind: 'narration', text: '朝の光。' },
    { kind: 'line', speaker: 'c1', text: 'おはよ' },
  ]);
  // 考える過程の途中は何も出さない
  assert.deepEqual(draftReply('<think>どう返そうか', 'perLine', resolve), []);
  assert.deepEqual(draftReply('<think>考えた</think>{"narration_0": "風', 'perLine', resolve), [{ kind: 'narration', text: '風' }]);
  // 自由な形式
  const free = '{"parts": [{"kind": "narration", "speaker": "", "text": "雨。"}, {"kind": "line", "speaker": "ひなた", "text": "傘、ある';
  assert.deepEqual(draftReply(free, 'free', resolve), [
    { kind: 'narration', text: '雨。' },
    { kind: 'line', speaker: 'c1', text: '傘、ある' },
  ]);
  assert.deepEqual(draftReply('{"parts": [{"kind": "line", "speaker": "', 'free', resolve), []);
});

test('書きかけの返答と書き終えた返答は、同じ吹き出しになる', () => {
  const resolve = (n: string) => (n === 'ひなた' ? 'c1' : undefined);
  const raw = '{"narration_0": "朝。", "speaker_0": "ひなた", "line_0": "「おはよう」", "narration_1": "", "present": ["ひなた"], "location": "", "time": "", "weather": "", "changes": ""}';
  assert.deepEqual(draftReply(raw, 'perLine', resolve), parseReply(raw, 'perLine', resolve).parts);
});
