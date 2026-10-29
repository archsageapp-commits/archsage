import { DEFAULT_STYLE } from './style.ts';
import type { ComfyNodeMap, ImageProfile, Plot, Preset, Settings } from './types.ts';

export const DEFAULT_PRESET: Preset = {
  id: 'default',
  name: '標準',
  systemPrompt: [
    'あなたは物語の語り手として、{{user}}との共同のロールプレイを進めます。',
    '登場するキャラは、それぞれのプロフィールにある口調、一人称、性格、関係を守って演じてください。',
    '情景、表情、しぐさを具体的に描き、会話が自然に続くようにしてください。',
    '同じ言い回しや展開をくり返さず、キャラが自分の意思で行動し、物語を前に進めてください。',
  ].join('\n'),
  postHistory: '',
};

// 値は Anima の説明書きのおすすめに合わせる。モデルの名前は公式の配布のもの
const ANIMA_NEGATIVE = 'worst quality, low quality, artist name, blurry, jpeg artifacts, chromatic aberration';
export const DEFAULT_IMAGE_PROFILES: ImageProfile[] = [
  {
    id: 'anima-base',
    name: 'Anima Base',
    model: 'anima-base-v1.0.safetensors',
    steps: 30,
    cfg: 4.5,
    sampler: 'er_sde',
    scheduler: 'normal',
    qualityTags: 'masterpiece, best quality, score_7',
    negative: 'worst quality, low quality, score_1, score_2, score_3, artist name, blurry, jpeg artifacts, chromatic aberration',
  },
  {
    // 前からある id のまま。Aesthetic は score タグを使わない
    id: 'anima',
    name: 'Anima Aesthetic',
    model: 'anima-aesthetic-v1.1.safetensors',
    steps: 30,
    cfg: 4.5,
    sampler: 'euler',
    scheduler: 'normal',
    qualityTags: 'masterpiece, best quality',
    negative: ANIMA_NEGATIVE,
  },
  {
    // CFG 1 ではネガティブは効かない
    id: 'anima-turbo',
    name: 'Anima Turbo',
    model: 'anima-turbo-v1.1.safetensors',
    steps: 10,
    cfg: 1,
    sampler: 'euler',
    scheduler: 'normal',
    qualityTags: 'masterpiece, best quality',
    negative: ANIMA_NEGATIVE,
  },
];

// 同梱の Anima ワークフローのノード
// カバーの大きさは固定。画面の一覧やシナリオの画面がこの比率（およそ3:4）で表示するため、挿絵の設定とは分ける
export const COVER_SIZE = { width: 1024, height: 1536 } as const;

export const ANIMA_NODE_MAP: ComfyNodeMap = {
  positive: { node: '11', input: 'text' },
  negative: { node: '12', input: 'text' },
  seed: { node: '19', input: 'seed' },
  width: { node: '28', input: 'width' },
  height: { node: '28', input: 'height' },
  model: { node: '44', input: 'unet_name' },
  steps: { node: '19', input: 'steps' },
  cfg: { node: '19', input: 'cfg' },
  sampler: { node: '19', input: 'sampler_name' },
  scheduler: { node: '19', input: 'scheduler' },
};

// 投稿サイトの URL。手元の仮のサイト（npm run dev:site）で試すときは、設定の「投稿サイト」で http://127.0.0.1:8792 にする
export const DEFAULT_SITE_URL = 'https://archsage.app';

export function defaultSettings(): Settings {
  return {
    connections: [],
    sampling: { temperature: 0.9, topP: 0.95, maxTokens: 2048 },
    stream: true,
    you: { name: '', sex: 'male' },
    contextTokens: 32000,
    historyMode: 'summarize',
    loreScanDepth: 4,
    imageProfileId: 'anima',
    imageProfiles: DEFAULT_IMAGE_PROFILES,
    comfy: {
      url: 'http://127.0.0.1:8188',
      workflow: null,
      workflowName: '',
      nodeMap: {},
      width: 1024,
      height: 1536,
      loras: [],
    },
    llmPrompts: {},
    styleTexts: {},
    onboarded: false,
    site: { url: DEFAULT_SITE_URL },
  };
}

export function emptyPlot(id: string, now: number): Plot {
  return {
    id,
    title: '',
    story: '',
    narratorNote: '',
    characters: [],
    playerPosition: '',
    players: [],
    examples: '',
    lorebookIds: [],
    intros: [{ text: '' }],
    style: { ...DEFAULT_STYLE, styleTags: '', defaultSafety: 'safe', defaultUserMode: 'exclude' },
    listing: { tagline: '', hashtags: [], intro: '', creatorComment: '', rating: 'all', sourceTitle: '' },
    createdAt: now,
    updatedAt: now,
  };
}

// 内部プロンプト。設定画面で上書きでき、変更したものだけ保存する
export const DEFAULT_LLM_PROMPTS: Record<string, string> = {
  'reply.perLine': [
    '# 返答の形',
    '返答はJSONだけで書く。欄の意味は次のとおり。',
    '- {{fields}} の順に、地の文とセリフを交互に並べる。',
    '- speaker_N は話す人の名前を、話せる人（{{speakers}}）から選ぶ。line_N はその人のセリフだけを書き、「」は付けない。',
    '- 1人が言うセリフは1回だけ。話さない欄は speaker と line を空にする。地の文が要らない欄も空でよい。',
    '- 地の文には、表情、しぐさ、情景を書く。地の文にセリフ（「」）は書かず、セリフは line_N だけに書く。',
    '{{common}}',
  ].join('\n'),
  'reply.free': [
    '# 返答の形',
    '返答はJSONだけで書く。parts に、地の文とセリフを話の順に好きな数だけ並べる。',
    '- 地の文は kind を "narration" にし、speaker は空にする。',
    '- セリフは kind を "line" にし、speaker に話す人の名前を、話せる人（{{speakers}}）から選ぶ。text はセリフだけを書き、「」は付けない。',
    '{{common}}',
  ].join('\n'),
  'reply.common': [
    '- present: 返答の終わりの時点でその場にいる人の名前の配列（{{user}}は入れない）。',
    '- location: 今の場所を日本語で短く（例「教室」「ひなたの部屋」）。',
    '- time: 時間帯を日本語で短く（早朝、朝、昼、夕方、夜、深夜など）。',
    '- weather: 天気を日本語で短く（晴れ、曇り、雨、雪など。屋内でも外の天気を書く）。',
    '- changes: 服装、場所、体位や姿勢が変わったときだけ、人ごとに一言で書く（例「ひなた: 上着を脱いだ」）。変わらなければ空にする。',
    'その場にいない人のセリフや行動は書かない。',
  ].join('\n'),
  'reply.rp': '{{user}}のセリフ、行動、心の中は書かない。{{user}}の発言を受けて、ほかの人の反応を書く。',
  'reply.novel': '{{user}}を含む全員の行動とセリフを書く。利用者の発言は、物語をどう進めるかの指示として扱う。{{user}}も話せる人に含まれる。',

  'note.header': '<system_note>\n{{body}}\n</system_note>',
  'note.present': 'その場にいる人: {{present}}',
  'note.location': '今の場所: {{location}}',
  'note.timeWeather': '時間帯と天気: {{time}}{{#weather}}、{{weather}}{{/weather}}',
  'note.pinned': '利用者が決めた状況（これに合わせる）: {{fix}}',
  'note.instruction': '次の返答への指示: {{instruction}}',

  'illust.system': [
    'あなたは、ロールプレイの最新の場面を1枚の挿絵にするための情報を作る係です。',
    '会話を読み、場面の状態を更新し、画像生成用の英語を書きます。出力はJSONだけです。',
    '',
    '# 出力の欄',
    '- outfits: 服装が変わった部位だけを書く。person は人の名前、slot は部位、item は服の名前、worn は着ているか、state は着崩しの状態。',
    '  - 部位: headwear（帽子など）、outerwear（上着）、top（上の服）、onepiece（ワンピース、ドレス、水着の一体型など）、bottom（スカート、ズボン）、bra、panties、legwear（靴下、タイツ）、footwear（靴）、accessories（眼鏡、首輪など）。',
    '  - item と state は短い英語の名詞句（例 item "white blouse" state "unbuttoned"、item "pleated skirt" state "lifted"、item "panties" state "pulled aside"）。普通に着ているときは state を空にする。',
    '  - 脱いだときは worn を false にする。新しく着たときは worn を true にして item を書く。',
    '  - 変わっていない部位や人は書かない。',
    '  - 「今の服装」が今の正しい状態。変わったかどうかは、直近の会話のうち最後の返答だけで決める。それより前の会話に書かれた着替えや着崩しは、もう「今の服装」に入っている。',
    '- location: 場所が変わったときだけ name（日本語）と tags（英語の背景タグ。例 "classroom, indoors, desk, window"）を書く。時間帯や天気のタグは入れない。変わらなければ両方空にする。',
    '- pose: 体位や姿勢、続いている接触が変わったときだけ changed を true にして書く。変わったかどうかは、服装と同じく最後の返答だけで決める。position は短い英語の名詞句（例 "sitting on the bench"、"missionary"、"standing"）。contacts は続いている接触で、who に関わる人の名前、what に短い英語の名詞句（例 "hugging"、"holding hands"、"sex"、"fellatio"、"kissing"）。',
    '- framing: 構図を1つ選ぶ（"upper body"、"cowboy shot"、"full body"、"close-up"、"from above"、"from below"、"from behind" など）。',
    '- action: 場面全体の、人ごとでない動きや状態だけを短い英語の名詞句で書く（例 "holding hands"、"sitting at a table"）。人ごとの表情としぐさは positions の action に書く。人の名前は書かない。',
    '- scene: 場面の1つの瞬間を英文で2〜4文で書く。「then」などで続けて起きることは書かない（コマ割りの絵になる）。描く人は必ず {名前} の形で書く（「描く人」にある名前をそのまま括弧で囲む。例 "{ひなた} leans over the table toward {ユウ} and talks to her excitedly. {ユウ} looks up at her and listens."）。外見と服装はアプリが {名前} のところに入れるので書かない。誰が誰に何をしているか、どこを見ているかを、人同士を主語と目的語にした文で書き、表情もここに書く。描かない人は出さない。',
    '- viewer: 「主観」の欄があるときだけ使う。ないときは none。',
    '- positions: 描く人ごとに、person に名前、position に画面上の位置（例 "on the left"、"in the foreground"）、action にその人だけの表情としぐさを短い英語の名詞句で書く。scene に名前を書けなかった人の予備に使う。',
    '',
    '2人以上を描くときは、それぞれが別々にこちらを向くのではなく、同じ場所で関わり合っている一瞬を選ぶ（向き合う、のぞき込む、手を伸ばす、振り返るなど）。全員がまっすぐ立って横に並ぶ構図にしない。',
    '性的な場面も、起きていることをそのまま具体的に書く。性的な状態や行為の例: nude、topless、bottomless、breasts out、nipples、spread legs、sex、vaginal、cum、fellatio、paizuri、handjob、masturbation、groping。',
  ].join('\n'),
  'illust.cover':
    'これはシナリオのサムネイル（縦長のキービジュアル）にする1枚です。導入の場面から、登場人物が同じ場所で関わり合っている、物語を感じる一瞬を選んでください。全員がまっすぐ立って横に並ぶ構図や、正面を向いて立つだけの構図は避け、会話、しぐさ、視線、手元の物などで人同士の関係が分かるようにします。framing は "cowboy shot"、"full body"、"from above"、"dutch angle" などから場面に合うものを選びます。服装と場所は変えずに空のままでかまいません。',
  // 主観で遊ぶときだけ足す。pov のタグを使わず、見る人を画面に出さないため（作業メモ「主観の挿絵」）
  'illust.pov': [
    '{{name}}は見る人（カメラ）で、絵には映りません。',
    '- {{name}}の体の動き（歩く、掃く、座るなど）は書かない。書くと、ほかの人の動きとして描かれる。',
    '- {{name}}が手で触れる、つかむ、渡すなどをしているときだけ、「{{{name}}}\'s hand」「{{{name}}}\'s hands」の形で手の動きを書く。',
    '- viewer に、{{name}}の体のどこが絵に入るかを1つ選ぶ。none: 入らない（話している、見ているだけ）。hands: 手だけ（触れる、つかむ、渡す、指を入れるなど）。body: 胸から下の体と性器（挿入、パイズリ、フェラチオ、手コキなど、{{name}}の下半身を使っているとき）。',
    '- ほかの人が{{name}}に向けてすることは「looks at {{{name}}}」「bows to {{{name}}}」のように書いてよい。',
  ].join('\n'),
  'illust.user': [
    '# 人',
    '{{people}}',
    '',
    '# 今の服装',
    '{{outfits}}',
    '',
    '# 今の場所',
    '{{location}}',
    '',
    '# 今の体位と接触',
    '{{pose}}',
    '',
    '# 前回の挿絵から後の変化',
    '{{changes}}',
    '',
    '# 描く人',
    '{{drawn}}',
    '',
    '{{#pov}}# 主観',
    '{{pov}}',
    '',
    '{{/pov}}',
    '# 直近の会話',
    '{{history}}',
  ].join('\n'),

  'summary.system': [
    'あなたはロールプレイの記録係です。渡された会話を、後で物語を続けるためのあらすじにまとめます。',
    '書くこと: 起きた出来事、人と人の関係の変化、約束や伏線、決まったこと。',
    '書かないこと: 服装、場所、体位（別に記録しているため）。',
    '日本語の地の文で、時系列に、短く書く。',
  ].join('\n'),
  'summary.user': '{{#previous}}# これまでのあらすじ\n{{previous}}\n\n{{/previous}}# まとめる会話\n{{history}}',
  'summary.merge': '次の複数のあらすじを、時系列を保ったまま1つのあらすじにまとめ直してください。重複は省き、伏線と関係の変化は残します。\n\n{{summaries}}',

  'wizard.system': [
    'あなたは、ロールプレイ用のシナリオを作る手伝いをします。シナリオは、AIが語り手とキャラを演じ、ユーザーがプレイヤーを演じて、会話で進める物語です。',
    '利用者はコンセプトを書き、筋書き、キャラ、プレイヤー、導入を決めていきます。どの部分も、あとから1つずつ作り直したり、足したりします。',
    '- 決まっていることと矛盾させない。',
    '- ユーザーが演じる人物（プレイヤー）は、文章の中で {{user}} と書く。',
    '- 英語と指定した欄のほかは、日本語で書く。',
    '- 返答はJSONだけにする。',
  ].join('\n'),
  'wizard.user': [
    '{{#concept}}# コンセプト',
    '{{concept}}',
    '',
    '{{/concept}}{{#decided}}# 決まっていること',
    '{{decided}}',
    '',
    '{{/decided}}{{#current}}# 作り直す人',
    '{{current}}',
    '',
    '{{/current}}# 今の段',
    '{{task}}',
    '',
    '{{#previous}}# 前に出した候補（注文がなければ、これとは違う方向の案にする）',
    '{{previous}}',
    '',
    '{{/previous}}{{#request}}# 利用者からの注文（これを優先する）',
    '{{request}}',
    '{{/request}}',
  ].join('\n'),
  'wizard.story': [
    '筋書きの候補を、互いに方向の違う3つ出してください。返答は {"candidates":[…]} の形で、候補ごとに次の欄を書く。',
    '- pitch: 候補の違いが一目で分かる一言（30字ほど）',
    '- title: 題名',
    '- story: 世界観、舞台、今の状況、物語の目的や謎を300〜500字で。キャラの細かい設定は次の段で決めるので、役割の大まかな説明にとどめる',
    '- playerPosition: {{user}}がこの物語でどんな立場にいるかを1〜2文で',
  ].join('\n'),
  'wizard.character': [
    'キャラを1人作ってください。返答は次の欄を持つJSONのオブジェクト1つ。',
    '- name: 呼び名だけ。読み仮名や括弧は付けない',
    '- sex: female か male',
    '- profile: 年齢や立場、一人称、口調と語尾の例、性格、見た目、{{user}}やほかのキャラとの関係を200〜400字で',
    '- appearanceText: 見た目を英語で1文。髪型、髪の色、目の色、体つきを入れ、服は入れない（例 "a girl with long black hair, red eyes and a slender build"）',
    '- outfit: 物語の始まりの服装。部位ごとに slot と item（英語の短い名詞句）。部位は headwear、outerwear、top、onepiece、bottom、bra、panties、legwear、footwear、accessories。身に着けていない部位は書かない。下着も書く',
    '作り直す人がいるときは、注文で変えるよう言われたところだけを変え、名前、役割、ほかのキャラや{{user}}との関係はそのまま残す。注文がなければ、名前と、筋書きやほかのキャラから分かる役割はそのままに、人物を新しく考え直す。',
    '作り直す人がいなければ、すでにいるキャラと役割や性格が重ならない新しい人にする。コンセプトに出てくる人物でまだいない人がいれば、その人にする。{{user}}はキャラに入れない。',
  ].join('\n'),
  'wizard.player': [
    '{{user}}（ユーザーが演じる人物）を1人作ってください。キャラとは別の人物にする。返答は次の欄を持つJSONのオブジェクト1つ。',
    '- name: 名前（呼び名だけ。読み仮名や括弧は付けない）',
    '- sex: male か female',
    '- profile: 年齢や立場、性格、見た目を100〜200字で。セリフや行動はユーザーが決めるので、口調は書かない',
    '- appearanceText: 見た目を英語で1文。髪型、髪の色、目の色、体つきを入れ、服は入れない（例 "a girl with long black hair, red eyes and a slender build"）',
    '- outfit: 物語の始まりの服装。部位ごとに slot と item（英語の短い名詞句）。部位は headwear、outerwear、top、onepiece、bottom、bra、panties、legwear、footwear、accessories。身に着けていない部位は書かない。下着も書く',
    '作り直す人がいるときは、注文で変えるよう言われたところだけを変え、名前と立場はそのまま残す。注文がなければ、名前と、筋書きから分かる立場はそのままに、人物を新しく考え直す。',
  ].join('\n'),
  'wizard.intro': [
    '物語の出だしの場面の候補を、互いに違う3つ出してください。返答は {"candidates":[…]} の形で、候補ごとに次の欄を書く。',
    '- pitch: 場面の違いが一目で分かる一言（30字ほど）',
    '- text: 最初の語りを200〜400字で。地の文と、キャラのセリフを「名前「セリフ」」の形で1行ずつ書く。{{user}}の行動やセリフは書かず、{{user}}が応じたくなるところで止める',
    '- present: 場面にいるキャラの名前。「この場面にいるキャラ」に書いた人だけにする',
    '- location: 場所の名前',
    '- locationTags: 場所の背景を表す英語のタグを1つずつ（例 classroom、indoors、window、bookshelf）',
    '- time: 時間帯を短く（早朝、朝、昼、夕方、夜、深夜など）',
    '- weather: 天気を短く（晴れ、曇り、雨、雪など）',
  ].join('\n'),
  'wizard.illust': [
    'キャラと{{user}}それぞれの挿絵の設定を作ってください。返答は {"people":[…]} の形で、人ごとに次の欄を書く。',
    '- name: 決まっていることにある名前のまま。{{user}}は {{user}} と書く',
    '- sex: female か male',
    '- appearanceText: 見た目を英語で1文。髪型、髪の色、目の色、体つきを入れ、服は入れない（例 "a girl with long black hair, red eyes and a slender build"）',
    '- outfit: 物語の始まりの服装。部位ごとに slot と item（英語の短い名詞句）。部位は headwear、outerwear、top、onepiece、bottom、bra、panties、legwear、footwear、accessories。身に着けていない部位は書かない。下着も書く',
  ].join('\n'),
  'wizard.listing': [
    'このシナリオの紹介と会話の例を作ってください。返答は次の欄を持つJSONのオブジェクト1つ。',
    '- tagline: 一覧に出す一言（30字ほど）',
    '- intro: 紹介文を150〜300字で。読む人に向けて、どんな体験ができるかを書く。読む人のことは {{user}} ではなく「あなた」と書く',
    '- hashtags: ジャンルや雰囲気のハッシュタグを3〜5個。# は付けない',
    '- examples: 会話の例を1行ずつ。キャラごとの口調が分かるように、{{user}}とキャラのやりとりを3〜6行、「名前「セリフ」」の形で書く。{{user}}の行は「{{user}}「セリフ」」',
  ].join('\n'),
};

export function llmPrompt(key: string, overrides: Record<string, string> = {}): string {
  return overrides[key] ?? DEFAULT_LLM_PROMPTS[key] ?? '';
}
