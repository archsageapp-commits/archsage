# Archsage

自分のPCで動く、ロールプレイチャットのアプリです。AIが語り手とキャラクターを演じ、あなたが主人公を演じて、会話で物語を進めます。返答に合わせて挿絵が自動で付きます。

- **シナリオ**: 世界観、複数のキャラクター、主人公、導入、設定集をまとめたもの。AIと相談しながら作ることもできます
- **チャット**: その場にいる人、場所、服装、時間帯などの状況を追いかけ、会話と挿絵に使います
- **挿絵**: ComfyUI で作ります（Anima 用のワークフローを同梱）
- **投稿サイト**: [Archsage シナリオ置き場](https://archsage.app) でシナリオと設定集を探して、「アプリで開く」で取り込めます。自分のシナリオの投稿もアプリからできます（サイトは日本国内からのみ）

## ダウンロード

Windows 用のインストーラーを [Releases](https://github.com/archsageapp-commits/archsage/releases) に置いています。`Archsage Setup （版）.exe` をダウンロードして実行してください。

インストーラーには署名をしていないため、「Windows によって PC が保護されました」と出ることがあります。そのときは「詳細情報」→「実行」で進めます。

## 使うのに必要なもの

会話と挿絵のAPIや環境は、利用者が用意します。アプリが料金を取ることはありませんが、使うAPIの料金は利用者の負担です。

- **会話（必須）**: OpenRouter、OpenAI 互換のAPI、ローカルLLM（KoboldCpp、Ollama、LM Studio）のどれか。返答はJSONで受け取るので、JSONで返せるモデルを選んでください
- **挿絵（なくても会話はできます）**: [ComfyUI](https://github.com/comfyanonymous/ComfyUI) と、Anima のモデル。くわしくは下の「Anima について」

## Anima について

[Anima](https://huggingface.co/circlestone-labs/Anima) は、CircleStone Labs と Comfy Org が作った、アニメ調のイラスト向けの画像生成モデルです（2B）。Danbooru 風のタグと英語の文のどちらでも指示でき、Archsage は両方を組み合わせて挿絵のプロンプトを作ります。写実的な絵は苦手です。

**入れるファイル**（Hugging Face のページから入手して、ComfyUI の次のフォルダに置きます）

| ファイル | 置く場所 |
| --- | --- |
| 拡散モデル（下の版のどれか） | `ComfyUI/models/diffusion_models` |
| `qwen_3_06b_base.safetensors`（テキストエンコーダー） | `ComfyUI/models/text_encoders` |
| `qwen_image_vae.safetensors`（VAE） | `ComfyUI/models/vae` |

**版**: 設定の画面の「プリセット」で切り替えます。版ごとに、モデルの名前、ステップ数、CFG、品質タグ、ネガティブがまとめて変わります。

| プリセット | ファイル | 向き |
| --- | --- | --- |
| Anima Aesthetic（初めの設定） | `anima-aesthetic-v1.1.safetensors` | 絵柄が整っていて安定する |
| Anima Turbo | `anima-turbo-v1.1.safetensors` | 速い（10ステップ）。絵のばらつきは少なめ |
| Anima Base | `anima-base-v1.0.safetensors` | 手を加えていない元のモデル。LoRA を作る人向け |

ファイルの名前を変えて置いたときは、プリセットの「モデル」で ComfyUI にあるファイルから選び直せます。LoRA も設定の画面で足せます。

**ライセンス**: Anima は CircleStone Labs の非商用ライセンスです。作った画像は商用にも使えますが、モデルそのものを商用に使うには別のライセンスが要ります。くわしくは配布元のページを見てください。

Anima 以外のモデルを使うときは、そのモデルの ComfyUI のワークフローを「Export (API)」で書き出して、設定の画面で読み込めます。

## はじめかた

1. インストールして起動すると、初めの設定の画面が出ます。主人公の名前、会話に使うAPI、ComfyUI の URL（初めは `http://127.0.0.1:8188`）を入れます。あとから設定の画面で変えられます
2. シナリオがまだないときは、ホームの「サンプルを入れる」でサンプルのシナリオを入れて遊べます。自分で作るときは「シナリオ管理」から作ります
3. 投稿サイトのシナリオを遊ぶときは、サイトで「アプリで開く」を押します

データ（シナリオ、チャット、画像）は `%APPDATA%\Archsage\data` に保存されます。バックアップはこのフォルダをコピーするだけです。アプリのメニューの「データフォルダを開く」から開けます。

## 使うときの注意

- 会話と画像は、利用者が用意したAPIやモデルで、利用者のPCの中で作られます。作ったものの扱い（保存、公開、人に渡すこと）は利用者の責任です。使うAPIやモデルの規約にも従ってください
- 投稿サイトに投稿するときは、サイトの[規約](https://archsage.app/terms)と[ガイドライン](https://archsage.app/guidelines)に従ってください

## ライセンス

AGPL-3.0。同梱している部品のライセンスは `THIRD_PARTY_NOTICES.txt` にあります。
