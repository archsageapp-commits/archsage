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

挿絵は、[Anima](https://huggingface.co/circlestone-labs/Anima) という画像生成AIで作ります。自分のPCで動かせて、アニメ調のイラストが得意です。動かすには、ある程度の性能の GPU（グラフィックボード）が要ります。

Anima は、タグだけでなく英語の文でも指示できます。これは SDXL 系のモデルにはない特長で、Archsage は場面の様子を英語の文にして渡しています。そのため、Anima 以外のモデルには対応していません。

**モデルを入れる**

- 基本のモデルは、[Hugging Face の Anima のページ](https://huggingface.co/circlestone-labs/Anima)から入手できます。初めの設定は `anima-aesthetic-v1.1.safetensors` です
- [Civitai](https://civitai.com/) で配られている Anima の派生モデルも使えます。設定の画面の「プリセット」の「モデル」で選びます

どのモデルでも、Hugging Face のページにある次の2つのファイルが要ります。

- `qwen_3_06b_base.safetensors` → `ComfyUI/models/text_encoders`
- `qwen_image_vae.safetensors` → `ComfyUI/models/vae`

モデル本体は `ComfyUI/models/diffusion_models` に置きます。

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
