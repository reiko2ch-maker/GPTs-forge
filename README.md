# GPTs FORGE — GitHub Pages 直結・Gemini無料キー版 v3

このセットは **GitHub Pages にそのまま置く専用版** です。
Cloudflare Worker 版ではありません。

## 使い方
1. GitHub リポジトリのルートに `index.html` をアップロード
2. `Settings` → `Pages`
3. Branch を `main`、Folder を `/ (root)` に設定
4. 数十秒〜数分待って公開 URL を開く

## この版のポイント
- GitHub Pages 直結
- Gemini API をブラウザから直接呼び出す
- `gemini-2.5-flash-lite` を優先し、使えない時は `gemini-2.5-flash` に自動切替
- フェーズを細分化して失敗しにくくした
- 途中フェーズ保存と自動再開あり
- 履歴は IndexedDB 優先、失敗時は localStorage に軽量保存

## 注意
- 無料キーでも使える構成を狙っていますが、Google 側の無料枠・混雑・回線状況で失敗することはあります
- API キーを HTML に埋め込まず、画面上から入力してください
