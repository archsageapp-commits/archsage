import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateCountTags,
  buildWizardMessages,
  buildPersonMessages,
  applyWizardChoice,
  applyWizardPerson,
  emptyWizard,
  parseWizardCandidates,
  parseWizardPerson,
  removeWizardCharacter,
  wizardStale,
  parseWizardIllust,
  parseWizardListing,
  applyWizardFinish,
  asYou,
  buildChatPrompt,
  buildImagePrompt,
  DEFAULT_IMAGE_PROFILES,
  DEFAULT_PRESET,
  defaultSettings,
  emptyPlot,
  normalizePlot,
  genitalsVisible,
  exposedParts,
  pinEdits,
  releasePins,
  pinsText,
  initialState,
  lightPhrases,
  mergeOutfit,
  diffOutfit,
  parseReply,
  personSentence,
  renderTemplate,
  stripTimeWeatherTags,
  textToParts,
  visibleSlots,
  applyIllustResult,
  parseIllustResult,
  drawnPeople,
  illustPeople,
  type Chat,
  type ImagePerson,
  type Message,
  type OutfitState,
  type Player,
  type Plot,
  normalizeSafety,
} from '../src/index.ts';

const anima = DEFAULT_IMAGE_PROFILES.find((p) => p.id === 'anima') as (typeof DEFAULT_IMAGE_PROFILES)[number];

const school: OutfitState = {
  slots: {
    top: { item: 'white shirt', worn: true, state: '' },
    bottom: { item: 'pleated skirt', worn: true, state: '' },
    bra: { item: 'white bra', worn: true, state: '' },
    panties: { item: 'white panties', worn: true, state: '' },
    legwear: { item: 'black thighhighs', worn: true, state: '' },
    footwear: { item: 'loafers', worn: true, state: '' },
  },
};

test('テンプレートは置換と空の節の削除だけをする', () => {
  assert.equal(renderTemplate('{{user}}と{{char}}', { user: 'ユウ', char: 'ひなた' }), 'ユウとひなた');
  assert.equal(renderTemplate('A{{#x}}[{{x}}]{{/x}}B', { x: '' }), 'AB');
  assert.equal(renderTemplate('A{{#x}}[{{x}}]{{/x}}B', { x: '1' }), 'A[1]B');
  assert.equal(renderTemplate('{{unknown}}', {}), '{{unknown}}');
});

test('服で隠れた下着は入れず、はだけていれば入れる', () => {
  assert.deepEqual(
    visibleSlots(school).map((s) => s.key),
    ['top', 'bottom', 'legwear', 'footwear'],
  );
  const open = mergeOutfit(school, { top: { state: 'unbuttoned' } });
  assert.ok(visibleSlots(open).some((s) => s.key === 'bra'));
  const up = visibleSlots(school, { upperBodyOnly: true }).map((s) => s.key);
  assert.deepEqual(up, ['top']);
});

test('性器は下半身を覆う部位がすべて脱がれているか、ずれているときに見えている', () => {
  assert.equal(genitalsVisible(school), false);
  const noSkirt = mergeOutfit(school, { bottom: { worn: false } });
  assert.equal(genitalsVisible(noSkirt), false);
  const aside = mergeOutfit(noSkirt, { panties: { state: 'pulled aside' } });
  assert.equal(genitalsVisible(aside), true);
  const lifted = mergeOutfit(school, { bottom: { state: 'lifted' }, panties: { worn: false } });
  assert.equal(genitalsVisible(lifted), true);
  assert.equal(genitalsVisible({ slots: {} }), false);
});

test('女性の乳首は胸を覆う部位がすべて脱がれているか、はだけている・ずれているときに見え、露出に出る', () => {
  assert.deepEqual(exposedParts(school, 'female'), []);
  const open = mergeOutfit(school, { top: { state: 'unbuttoned' } });
  assert.deepEqual(exposedParts(open, 'female'), []);
  const up = mergeOutfit(open, { bra: { state: 'pushed up' } });
  assert.deepEqual(exposedParts(up, 'female'), ['nipples']);
  const naked = mergeOutfit(up, { bottom: { worn: false }, panties: { worn: false } });
  assert.deepEqual(exposedParts(naked, 'female'), ['nipples', 'pussy']);
  assert.deepEqual(exposedParts(naked, 'female', { upperBodyOnly: true }), ['nipples']);
  // 男性は乳首を出さない
  assert.deepEqual(exposedParts(naked, 'male'), ['penis']);
  const out = buildImagePrompt({ profile: anima, safety: 'nsfw', userMode: 'exclude', styleTags: '', people: [{ id: 'a', sex: 'female', countTag: '1girl', appearanceText: 'a girl', outfit: naked, isPlayer: false }], scene: 'She smiles.' });
  assert.ok(out.positive.includes('with exposed nipples and pussy'));
});

test('手で直した欄は覚えておき、返答や追跡で値が変わったら外す', () => {
  const prev = { present: ['a'], time: '夕方', outfits: { a: school } };
  const next = { present: ['a'], time: '夜', outfits: { a: mergeOutfit(school, { top: { state: 'unbuttoned' }, bottom: { worn: false } }) } };
  const pins = pinEdits([], prev, next);
  assert.deepEqual(pins.map((p) => (p.field === 'outfit' ? p.slot : p.field)), ['time', 'top', 'bottom']);
  assert.equal(pinsText(pins, () => 'ひなた'), '時間帯は夜、ひなたの上はunbuttoned white shirt、ひなたの下は着ていない');
  // 同じ欄をまた直すと、新しい値にする
  const again = pinEdits(pins, next, { ...next, time: '深夜' });
  assert.equal(again.length, 3);
  assert.equal(again[0].value, '深夜');
  // 同じ値のままなら残し、変わった欄は外す
  assert.equal(releasePins(pins, next).length, 3);
  const moved = { ...next, time: '朝', outfits: { a: mergeOutfit(next.outfits.a, { top: { worn: false } }) } };
  assert.deepEqual(releasePins(pins, moved).map((p) => (p.field === 'outfit' ? p.slot : p.field)), ['bottom']);
});

test('前に保存した外見タグは、英文がなければ英文に移し、英文があれば捨てる', () => {
  const old = (illust: object) => normalizePlot({ characters: [{ id: 'a', name: 'a', profile: '', illust } as never] }).characters[0].illust;
  assert.equal(old({ sex: 'female', appearanceTags: 'short hair, brown eyes', appearanceText: '' }).appearanceText, 'short hair, brown eyes');
  const both = old({ sex: 'female', appearanceTags: 'short hair', appearanceText: 'a girl with short hair' });
  assert.equal(both.appearanceText, 'a girl with short hair');
  assert.ok(!('appearanceTags' in both));
});

test('前に保存した服装の日本語の欄は読み捨て、英語だけを残す', () => {
  const plot = normalizePlot({ characters: [{ id: 'a', name: 'a', profile: '', illust: { sex: 'female', countTag: '1girl', appearanceText: '', defaultOutfit: { slots: { top: { item: 'white blouse', worn: true, state: '', itemJa: '白いブラウス', needsEn: true } as OutfitState['slots']['top'] & object } } } }] });
  assert.deepEqual(plot.characters[0].illust.defaultOutfit.slots.top, { item: 'white blouse', worn: true, state: '' });
});

test('人数タグをまとめる', () => {
  assert.deepEqual(aggregateCountTags(['1girl', '1girl']), ['2girls']);
  assert.deepEqual(aggregateCountTags(['1girl', '1boy']), ['1girl', '1boy']);
  assert.deepEqual(aggregateCountTags(['1girl', '1girl', '1girl', '1girl', '1girl', '1girl']), ['6+girls']);
});

test('背景タグから時間帯と天気を落とし、光と空の句を別に作る', () => {
  assert.equal(stripTimeWeatherTags('classroom, indoors, night, window, rain'), 'classroom, indoors, window');
  assert.deepEqual(lightPhrases('夕方', '晴れ'), ['sunset', 'warm orange light', 'clear sky']);
  assert.deepEqual(lightPhrases('夜', '雨'), ['night', 'dim lighting', 'rain']);
});

test('キャラごとの英文は「位置 → 外見 → 服装 → 性器」の順', () => {
  const s = personSentence(
    {
      id: 'a',
      sex: 'female',
      countTag: '1girl',
      appearanceText: 'a girl with long black hair and red eyes',
      outfit: mergeOutfit(school, { top: { state: 'unbuttoned' } }),
      isPlayer: false,
      position: 'on the left',
    },
    { upperBodyOnly: false, pov: false },
  );
  assert.equal(
    s,
    'On the left, a girl with long black hair and red eyes, wearing unbuttoned white shirt, pleated skirt, white bra, black thighhighs and loafers.',
  );
});

test('画像プロンプトの順番とネガティブ', () => {
  const out = buildImagePrompt({
    profile: anima,
    safety: 'safe',
    userMode: 'exclude',
    styleTags: '@artist',
    framing: 'cowboy shot',
    people: [
      { id: 'a', sex: 'female', countTag: '1girl', appearanceText: 'a girl with black hair', outfit: school, isPlayer: false, position: 'on the left' },
      { id: 'b', sex: 'female', countTag: '1girl', appearanceText: 'a girl with blonde hair', outfit: school, isPlayer: false, position: 'on the right' },
    ],
    pose: { position: 'standing', contacts: [{ who: ['a', 'b'], what: 'holding hands' }] },
    action: 'smile',
    location: { name: '教室', tags: 'classroom, indoors, night' },
    time: '夕方',
    scene: 'Two friends talk after school',
  });
  // 2人以上では場面の英文を人ごとの英文より先に置く
  assert.ok(out.positive.startsWith('masterpiece, best quality, safe, 2girls, @artist, cowboy shot. Two friends talk after school. On the left,'));
  assert.ok(out.positive.includes('standing, holding hands, smile, classroom, indoors, sunset'));
  assert.ok(!out.positive.includes('night'));
  assert.ok(out.positive.endsWith('sunset, warm orange light.'));
  // レーティングごとのネガティブは足さない
  assert.ok(!out.negative.includes('nsfw'));
  assert.ok(out.negative.includes('multiple views, split screen'));
});

test('主観では見る人を数えず、pov のタグも外見も服装も入れない。性器が見えていても、見え方が none なら書かない', () => {
  const out = buildImagePrompt({
    profile: anima,
    safety: 'nsfw',
    userMode: 'pov',
    styleTags: '',
    people: [
      { id: 'a', sex: 'female', countTag: '1girl', appearanceText: 'a girl', outfit: school, isPlayer: false },
      {
        id: 'user',
        sex: 'male',
        countTag: '1boy',
        appearanceText: 'a boy with black hair',
        outfit: { slots: { headwear: { item: 'cap', worn: true, state: '' }, bottom: { item: 'jeans', worn: false, state: '' } } },
        isPlayer: true,
      },
    ],
  });
  // 成人向けは nsfw と explicit を両方入れる
  assert.ok(out.positive.startsWith('masterpiece, best quality, nsfw, explicit, 1girl.'));
  // 前の4段階で保存した値も読む
  assert.deepEqual([normalizeSafety('explicit'), normalizeSafety('sensitive'), normalizeSafety('nsfw'), normalizeSafety(undefined)], ['nsfw', 'safe', 'nsfw', 'safe']);
  assert.ok(!/\bpov\b|1boy|hands|penis/.test(out.positive));
  assert.ok(!out.positive.includes('cap') && !out.positive.includes('black hair') && !out.positive.includes('jeans'));
});

const worker = (): ImagePerson => ({
  id: 'user',
  name: 'ユウ',
  sex: 'male',
  countTag: '1boy',
  appearanceText: 'a man with gray hair',
  outfit: { slots: { outerwear: { item: 'navy work jacket', worn: true, state: '' }, top: { item: 'gray undershirt', worn: true, state: '' }, bottom: { item: 'khaki work pants', worn: true, state: '' }, accessories: { item: 'work gloves', worn: true, state: '' } } },
  isPlayer: true,
});
const hinata: ImagePerson = { id: 'a', name: 'ひなた', sex: 'female', countTag: '1girl', appearanceText: 'a girl with orange hair', outfit: school, isPlayer: false };
const povPrompt = (scene: string, viewerShows?: 'none' | 'hands' | 'body', p: ImagePerson = worker()) =>
  buildImagePrompt({ profile: anima, safety: 'safe', userMode: 'pov', styleTags: '', people: [hinata, p], scene, pose: { position: 'kneeling between {ユウ}\'s legs', contacts: [] }, viewerShows }).positive;

test('主観では場面の英文の見る人の名前を「the viewer」にし、見え方が hands なら袖だけを添えた手の文を相手の後ろに足す', () => {
  const plain = povPrompt('{ひなた} bows to {ユウ}.', 'none');
  assert.ok(plain.includes('A girl with orange hair') && plain.includes('bows to the viewer.'));
  assert.ok(!plain.includes('hands') && !plain.includes('gray hair') && !plain.includes('khaki') && !plain.includes('undershirt'));
  // タグに残った {名前} も呼び方に直す
  assert.ok(plain.includes("kneeling between the viewer's legs") && !plain.includes('{'));
  const hands = povPrompt("{ユウ}'s hands hold out a racket to {ひなた}.", 'hands');
  const sleeve = "The viewer's own hands come out of his navy work jacket sleeves at the bottom edge of the frame.";
  assert.ok(hands.includes("The viewer's hands hold out a racket to a girl with orange hair") && hands.includes(sleeve));
  assert.ok(hands.indexOf('orange hair') < hands.indexOf(sleeve));
  assert.ok(!hands.includes('gloves'));
  // 見え方がないときは、場面の英文に手が書いてあれば手を出す
  assert.ok(povPrompt("{ユウ}'s fingers touch {ひなた}'s cheek.").includes("The viewer's own hands come out of"));
  assert.ok(!povPrompt('{ひなた} blushes.').includes("The viewer's own hands"));
});

test('主観で見え方が body なら、見る人の上と下の服と、見えていれば性器を1文で書く', () => {
  const w = worker();
  w.outfit.slots.bottom = { item: 'khaki work pants', worn: true, state: 'pulled down' };
  assert.ok(povPrompt('{ひなた} straddles {ユウ}.', 'body', w).includes("At the bottom of the frame is the viewer's own body, in navy work jacket over gray undershirt, with pulled down khaki work pants and his penis exposed."));
  // 下を脱いでいるときは下の服を書かない
  w.outfit.slots.bottom = { item: 'khaki work pants', worn: false, state: '' };
  assert.ok(povPrompt('{ひなた} straddles {ユウ}.', 'body', w).includes("At the bottom of the frame is the viewer's own body, in navy work jacket over gray undershirt, with his penis exposed."));
  // 性器が隠れていれば書かない
  assert.ok(povPrompt('{ひなた} sits on {ユウ}\'s lap.', 'body').includes("At the bottom of the frame is the viewer's own body, in navy work jacket over gray undershirt, with khaki work pants."));
});

function samplePlot(): { plot: Plot; player: Player; chat: Chat } {
  const plot = emptyPlot('p1', 0);
  plot.title = 'テスト';
  plot.story = '放課後の教室。';
  plot.characters = [
    { id: 'c1', name: 'ひなた', profile: '明るい。', illust: { sex: 'female', countTag: '1girl', appearanceText: 'a girl with black hair', defaultOutfit: school } },
    { id: 'c2', name: 'しずく', profile: '静か。', illust: { sex: 'female', countTag: '1girl', appearanceText: 'a girl with blue hair', defaultOutfit: school } },
  ];
  plot.intros = [{ text: 'ひなたが手を振った。', present: ['c1', 'c2'], location: { name: '教室', tags: 'classroom' } }];
  const player: Player = { id: 'u1', name: 'ユウ', description: '転校生', sex: 'male', countTag: '1boy' };
  const chat: Chat = {
    id: 'ch1',
    plotId: 'p1',
    title: '',
    introIndex: 0,
    player: { source: 'own', id: 'u1' },
    mode: 'rp',
    safety: 'safe',
    userMode: 'exclude',
    autoIllustrate: true,
    presetId: 'default',
    createdAt: 0,
    updatedAt: 0,
  };
  return { plot, player, chat };
}

test('1人1セリフの返答を欄の並びのまま読み、同じ人の2回目は捨てる', () => {
  const { plot, player } = samplePlot();
  const raw = JSON.stringify({
    narration_0: 'ひなたが笑った。',
    speaker_0: 'ひなた',
    line_0: '「おはよう！『本』読んだ？」',
    narration_1: '',
    speaker_1: 'ひなた',
    line_1: 'もう一回',
    narration_2: 'しずくは黙っていた。',
    present: ['ひなた', 'しずく'],
    location: '教室',
    time: '朝',
    weather: '晴れ',
    changes: '',
  });
  const resolve = (n: string) => plot.characters.find((c) => c.name === n)?.id ?? (n === player.name ? 'user' : undefined);
  const r = parseReply('```json\n' + raw + '\n```', 'perLine', resolve);
  assert.equal(r.parts.length, 3);
  assert.deepEqual(r.parts[1], { kind: 'line', speaker: 'c1', text: 'おはよう！『本』読んだ？' });
  assert.equal(r.parts[2].text, 'しずくは黙っていた。');
  assert.deepEqual(r.present, ['ひなた', 'しずく']);
});

test('編集した文章を吹き出しに戻す', () => {
  const parts = textToParts('ひなたが笑った。\nひなた「おはよう」\n謎の人「誰？」', (n) => (n === 'ひなた' ? 'c1' : undefined));
  assert.deepEqual(parts, [
    { kind: 'narration', text: 'ひなたが笑った。' },
    { kind: 'line', speaker: 'c1', text: 'おはよう' },
    { kind: 'line', speakerName: '謎の人', text: '誰？' },
  ]);
});

test('チャットのプロンプトは system_note を最後の利用者の発言に付ける', () => {
  const { plot, player, chat } = samplePlot();
  const state = initialState(plot, plot.intros[0], player);
  const history: Message[] = [
    { id: 'm1', chatId: 'ch1', role: 'assistant', activeSwipe: 0, createdAt: 0, swipes: [{ text: plot.intros[0].text, images: [], createdAt: 0, state }] },
    { id: 'm2', chatId: 'ch1', role: 'user', activeSwipe: 0, createdAt: 0, swipes: [{ text: 'やあ', images: [], createdAt: 0 }] },
  ];
  const s = defaultSettings();
  const p = buildChatPrompt({
    plot,
    chat,
    player,
    preset: DEFAULT_PRESET,
    settings: s,
    lorebooks: [{ id: 'lb', name: '学園', global: false, entries: [{ id: 'e1', keys: ['ひなた'], content: '教室は3階。', constant: false, enabled: true }] }],
    history,
    summaries: [],
    state,
    instruction: '場面を夜に進めて',
  });
  assert.equal(p.messages[0].role, 'system');
  assert.ok(p.messages[0].content.includes('# 物語\n放課後の教室。'));
  assert.ok(p.messages[0].content.includes('## ひなた'));
  assert.ok(p.messages[0].content.includes('教室は3階。'));
  const last = p.messages[p.messages.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(last.content.startsWith('やあ'));
  assert.ok(last.content.includes('<system_note>'));
  assert.ok(last.content.includes('その場にいる人: ひなた、しずく'));
  assert.ok(last.content.includes('次の返答への指示: 場面を夜に進めて'));
  assert.deepEqual(p.speakers, ['ひなた', 'しずく']);
  assert.ok('speaker_1' in (p.schema.properties as object));
});

test('挿絵の結果を、変わった欄だけ前の状態に重ねる', () => {
  const { plot, player, chat } = samplePlot();
  const state = initialState(plot, plot.intros[0], player);
  const people = illustPeople(plot, player, state);
  const result = parseIllustResult(
    JSON.stringify({
      outfits: [
        { person: 'ひなた', slot: 'top', item: '', worn: false, state: '' },
        { person: 'しずく', slot: 'top', item: '', worn: false, state: '' },
      ],
      location: { name: '', tags: '' },
      pose: { changed: true, position: 'sitting', contacts: [{ who: ['ひなた', 'しずく'], what: 'hugging' }] },
      framing: 'upper body',
      action: 'smile',
      scene: 'They hug.',
      positions: [],
    }),
  );
  const next = applyIllustResult(state, result, people);
  assert.equal(next.outfits.c1.slots.top?.worn, false);
  assert.equal(next.outfits.c2.slots.top?.worn, false);
  assert.equal(next.outfits.c1.slots.bottom?.worn, true);
  assert.deepEqual(next.pose?.contacts[0].who, ['c1', 'c2']);
  const drawn = drawnPeople({ text: '', images: [], createdAt: 0, parts: [{ kind: 'line', speaker: 'c2', text: 'a' }] }, next, chat);
  assert.deepEqual(drawn, ['c2']);
});

test('考える過程を混ぜた返答からもJSONを取り出す', async () => {
  const { extractJson } = await import('../src/reply.ts');
  assert.deepEqual(extractJson('<think>まず {a} を考える</think>\n{"x":1}'), { x: 1 });
  assert.deepEqual(extractJson('途中から始まる考え } </think> ```json\n{"y":2}\n```'), { y: 2 });
});

test('本文の終わりに紛れ込んだ閉じ括弧を取り除く', async () => {
  const { cleanText } = await import('../src/reply.ts');
  assert.equal(cleanText('聞こえていた。}'), '聞こえていた。');
  assert.equal(cleanText('{a}'), '{a}');
  assert.equal(cleanText('配列]]'), '配列');
});

test('地の文に同じセリフが書かれていたら消す', () => {
  const raw = JSON.stringify({
    narration_0: 'ひなたは身を乗り出した。\nひなた「読んでいいよ！」',
    speaker_0: 'ひなた',
    line_0: '読んでいいよ！',
    narration_1: 'しずく「別のセリフ」はそのまま',
    present: [],
    location: '',
    time: '',
    weather: '',
    changes: '',
  });
  const r = parseReply(raw, 'perLine', (n) => (n === 'ひなた' ? 'c1' : undefined));
  assert.deepEqual(
    r.parts.map((p) => p.text),
    ['ひなたは身を乗り出した。', '読んでいいよ！', 'しずく「別のセリフ」はそのまま'],
  );
});

test('場面の英文の {名前} を外見と服装に置き換え、2回目からは短く呼ぶ', () => {
  const people = [
    { id: 'a', name: 'ひなた', sex: 'female' as const, countTag: '1girl', appearanceText: 'a girl with orange hair', outfit: { slots: { top: { item: 'blazer', worn: true, state: '' }, bottom: { item: 'skirt', worn: true, state: '' } } }, isPlayer: false },
    { id: 'u', name: 'ユウ', sex: 'male' as const, countTag: '1boy', appearanceText: 'a boy with black hair', outfit: { slots: {} }, isPlayer: true },
    { id: 'b', name: 'しずく', sex: 'female' as const, countTag: '1girl', appearanceText: 'a girl with long black hair', outfit: { slots: {} }, isPlayer: false },
  ];
  const out = buildImagePrompt({
    profile: anima,
    safety: 'safe',
    userMode: 'include',
    styleTags: '',
    people,
    scene: '{ひなた} leans toward {ユウ}. {ユウ} looks up at {ひなた}, and {謎の人} waves.',
  });
  assert.ok(out.positive.includes('A girl with orange hair, wearing blazer and skirt, leans toward a boy with black hair.'));
  assert.ok(out.positive.includes('The boy looks up at the girl with orange hair, and 謎の人 waves.'));
  // 場面に出なかった人は、人ごとの英文で足す
  assert.ok(out.positive.includes('A girl with long black hair.'));
});

const char = (id: string, name: string, profile = '', tags = ''): Plot['characters'][number] => ({
  id,
  name,
  profile,
  illust: { sex: 'female', countTag: '1girl', appearanceText: tags, defaultOutfit: { slots: tags ? { top: { item: 'shirt', worn: true, state: '' } } : {} } },
});

test('手順の候補: 作る部分のほかは、シナリオに今あることを全部渡し、前の候補と注文を添える', () => {
  const plot = emptyPlot('p', 0);
  plot.title = '星見坂';
  plot.story = '魔法の残る町';
  plot.characters = [char('a', 'ひなた', '元気'), char('b', 'しずく', '静か')];
  const wizard = { ...emptyWizard('p'), concept: '学園もの', steps: { story: { candidates: [{ pitch: '雨の町', title: '雨音', story: 's', playerPosition: '' }] } } };
  const story = buildWizardMessages('story', plot, wizard, '暗めに')[1].content;
  // 筋書きを作り直すときも、キャラは決まったこととして渡す。今の筋書きは渡さない
  assert.ok(story.includes('学園もの') && story.includes('- ひなた: 元気') && story.includes('暗めに') && story.includes('- 雨の町（雨音）'));
  assert.ok(!story.includes('星見坂'));

  // 導入では、選んだキャラだけが場面にいると伝える
  const intro = buildWizardMessages('intro', plot, { ...wizard, present: ['b'] }, '')[1].content;
  assert.ok(intro.includes('- ひなた: 元気') && intro.includes('この場面にいるキャラ: しずく（'));
});

test('人を1人作る: 足すときは今いる全員を、作り直すときはその人を除いた全員と今の中身を渡す', () => {
  const plot = emptyPlot('p', 0);
  plot.story = '魔法の残る町';
  plot.characters = [char('a', 'ひなた', '元気', 'short hair'), char('b', 'しずく', '静か')];
  const wizard = { ...emptyWizard('p'), concept: '学園もの' };
  const add = buildPersonMessages('new', plot, wizard, '')[1].content;
  assert.ok(add.includes('すでにいるキャラ:\n- ひなた: 元気\n- しずく: 静か'));
  assert.ok(!add.includes('作り直す人の今の中身'));
  const remake = buildPersonMessages('a', plot, wizard, '年上に')[1].content;
  assert.ok(remake.includes('キャラ:\n- しずく: 静か') && remake.includes('名前: ひなた') && remake.includes('見た目: short hair') && remake.includes('服装: shirt') && remake.includes('年上に'));
  assert.ok(!remake.includes('- ひなた: 元気'));
  // 注文がなければ、今の中身は見せずに名前と性別だけを渡す
  const bare = buildPersonMessages('a', plot, wizard, '')[1].content;
  assert.ok(bare.includes('名前: ひなた') && !bare.includes('プロフィール: 元気') && !bare.includes('short hair'));
  assert.ok(buildPersonMessages('player', plot, wizard, '')[1].content.includes('- ひなた: 元気'));
});

test('人を1人作る: 返答の形がずれても読み、見た目の設定が空なら使わない', () => {
  const body = { name: 'ユウ', sex: 'boy', profile: '2年生', appearanceTags: ['black hair', 'brown eyes'], appearanceText: 'a boy', outfit: [{ slot: 'top', item: 'shirt' }, { slot: 'nope', item: 'x' }, { slot: 'headwear', item: 'none' }, { slot: 'bra', item: 'N/A' }] };
  // 知らない部位と、身に着けていない「なし」の部位は捨てる
  const p = parseWizardPerson(JSON.stringify(body));
  assert.deepEqual([p.name, p.sex, p.appearanceText, Object.keys(p.outfit.slots)], ['ユウ', 'female', 'a boy', ['top']]);
  assert.equal(parseWizardPerson(JSON.stringify({ character: body })).name, 'ユウ');
  assert.equal(parseWizardPerson('```json\n' + JSON.stringify([body]) + '\n```').name, 'ユウ');
  assert.throws(() => parseWizardPerson(JSON.stringify({ ...body, outfit: [] })), /空/);
});

test('人を1人入れる: 足すと最後に並び、作り直しても id とアイコンは残る。外すと導入からも外れる', () => {
  const plot = emptyPlot('p', 0);
  plot.characters = [{ ...char('a', 'ひなた', '元気', 'short hair'), avatar: 'plots/p/avatar-1.png' }];
  plot.intros = [{ text: '朝', present: ['a'] }];
  const person = { name: 'みお', sex: 'female' as const, profile: '静か', appearanceText: 'a girl', outfit: { slots: { top: { item: 'blouse', worn: true, state: '' } } } };
  const added = applyWizardPerson(plot, 'new', person);
  assert.deepEqual(added.plot.characters.map((c) => c.name), ['ひなた', 'みお']);
  assert.equal(added.id, added.plot.characters[1].id);
  const remade = applyWizardPerson(plot, 'a', { ...person, sex: 'male' });
  const r = remade.plot.characters[0];
  assert.deepEqual([r.id, r.name, r.avatar, r.illust.countTag], ['a', 'みお', 'plots/p/avatar-1.png', '1boy']);
  const player = applyWizardPerson(plot, 'player', { ...person, name: 'ユウ', profile: '転校生' });
  assert.deepEqual([player.plot.players[0].name, player.plot.players[0].description, player.plot.players[0].appearanceText], ['ユウ', '転校生', 'a girl']);
  assert.deepEqual(removeWizardCharacter(plot, 'a').intros[0].present, []);
});

test('導入の候補: 場面にいる人は選んだキャラの中だけにし、足すこともできる', () => {
  const plot = emptyPlot('p', 0);
  plot.characters = [char('a', 'ひなた'), char('b', 'しずく')];
  const c = { pitch: '', text: '放課後', present: ['ひなた', 'しずく'], location: '', locationTags: '', time: '', weather: '' };
  const one = applyWizardChoice(plot, 'intro', c, { present: ['b'] });
  assert.deepEqual(one.intros.map((i) => i.present), [['b']]);
  // 名前が合わなければ、選んだ全員を入れる
  assert.deepEqual(applyWizardChoice(plot, 'intro', { ...c, present: ['だれか'] }).intros[0].present, ['a', 'b']);
  const two = applyWizardChoice(one, 'intro', { ...c, text: '朝' }, { mode: 'add' });
  assert.deepEqual(two.intros.map((i) => i.text), ['放課後', '朝']);
});

test('段の見直し: 前の段があとから変わった段を知らせる', () => {
  const w = { ...emptyWizard('p'), changedAt: { story: 3, cast: 2, intro: 4, finish: 1 } };
  assert.deepEqual(wizardStale(w), ['cast', 'finish']);
});

test('手順の候補: 欠けた候補は捨てる', () => {
  assert.throws(() => parseWizardCandidates('story', '{"candidates":[]}'));
  assert.equal(parseWizardCandidates('story', JSON.stringify({ candidates: [{ pitch: 'a', title: 't', story: '' }, { pitch: 'b', title: 't', story: 's' }] })).length, 1);
  // 外側の形を省いた配列でも読む
  assert.equal(parseWizardIllust('```json\n[{"name":"ひなた","sex":"female","outfit":[{"slot":"top","item":"shirt"}]}]\n```')[0].name, 'ひなた');
});

test('手順の仕上げ: 読み仮名つきの名前でも同じ人として挿絵の設定を入れ、会話の例は配列でも読む', () => {
  const plot = emptyPlot('p', 0);
  plot.characters = [{ id: 'c', name: '陽葵（ひまり）', profile: '', illust: { sex: 'female', countTag: '1girl', appearanceText: '', defaultOutfit: { slots: {} } } }];
  const illust = parseWizardIllust(JSON.stringify({ people: [{ name: '陽葵', sex: 'female', appearanceText: 'a woman', outfit: [{ slot: 'top', item: 'white blouse' }] }] }));
  const listing = parseWizardListing(JSON.stringify({ tagline: 'a', intro: 'b', hashtags: [], examples: ['陽葵「いらっしゃい」', '{{user}}「どうも」'] }));
  const next = applyWizardFinish(plot, illust, listing);
  assert.equal(next.characters[0].illust.appearanceText, 'a woman');
  assert.equal(next.characters[0].illust.defaultOutfit.slots.top?.item, 'white blouse');
  assert.equal(next.examples, '陽葵「いらっしゃい」\n{{user}}「どうも」');
  // プレイヤーは {{user}} の名前で返ってくる
  plot.players = [{ id: 'u', name: '海斗', description: '', sex: 'male', countTag: '1boy' }];
  const withUser = applyWizardFinish(plot, [{ ...illust[0], name: '{{user}}', appearanceText: 'a boy with black hair' }], undefined);
  assert.equal(withUser.players[0].appearanceText, 'a boy with black hair');
  // 挿絵の設定がもうある人は、上書きしない
  const kept = applyWizardFinish({ ...plot, characters: [{ ...plot.characters[0], illust: { ...plot.characters[0].illust, appearanceText: 'a girl with red hair' } }] }, illust, undefined);
  assert.equal(kept.characters[0].illust.appearanceText, 'a girl with red hair');
});

test('手順の返答: 形だけで中身が崩れた返答は使わない', () => {
  assert.throws(() => parseWizardIllust(JSON.stringify({ people: [{ name: '汐里', sex: 'female', appearanceText: '', outfit: [] }] })), /空/);
  assert.equal(parseWizardListing(JSON.stringify({ tagline: 'a', intro: 'b', hashtags: [], examples: ':[' })).examples, '');
  const [intro] = parseWizardCandidates('intro', JSON.stringify({ candidates: [{ pitch: 'p', text: '本文', present: [], location: '店', locationTags: ':[', time: '', weather: '' }] }));
  assert.equal(intro.locationTags, '');
});

test('手順の返答: タグとセリフ例は配列でも文字列でも読む', () => {
  const [il] = parseWizardIllust(JSON.stringify({ people: [{ name: '澪', sex: 'female', appearanceTags: ['short hair', 'brown eyes'], appearanceText: '', outfit: [{ slot: 'top', item: 'shirt' }] }] }));
  // 外見の英文がなく、前の形のタグだけ返ってきたときは、タグを英文の代わりにする
  assert.equal(il.appearanceText, 'short hair, brown eyes');
  const [intro] = parseWizardCandidates('intro', JSON.stringify({ candidates: [{ pitch: 'p', text: '本文', present: [], location: '店', locationTags: ['cafe', 'indoors'], time: '', weather: '' }] }));
  assert.equal(intro.locationTags, 'cafe, indoors');
});
