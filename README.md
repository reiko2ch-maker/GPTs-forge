# GPTs FORGE — Cloudflare Worker 安定版

このセットは、見た目をほぼ維持したまま **Cloudflare Worker + Static Assets** で安定運用しやすくした版です。

## 特徴
- フロント直叩きではなく **Worker 経由** で Gemini を呼び出します。
- 生成を細かいフェーズに分割しています。
- フロント側に **途中フェーズのチェックポイント保存** と **自動再開** があります。
- GitHub にアップロードし、そのリポジトリを Cloudflare 側から接続してデプロイできます。

## フォルダ構成
- `public/index.html` : フロント本体
- `src/worker.js` : Gemini 呼び出しを中継する Worker
- `wrangler.jsonc` : Cloudflare Workers 設定
- `.dev.vars.example` : ローカル開発用の秘密鍵サンプル

## いちばん簡単な公開手順
1. GitHubで新しいリポジトリを作成
2. このフォルダの中身を全部アップロード
3. Cloudflare ダッシュボードで **Workers & Pages** を開く
4. **Import a repository** でそのGitHubリポジトリを接続
5. デプロイ設定は基本そのままでOK
6. Cloudflare 側で Worker の秘密鍵 `GEMINI_API_KEY` を追加
7. 再デプロイ

## ローカル開発
```bash
npm install
cp .dev.vars.example .dev.vars
# .dev.vars に実際の Gemini APIキーを入れる
npm run dev
```

## 運用メモ
- 画面上のAPIキー欄は **空欄でも実行可能** です。Worker に `GEMINI_API_KEY` を設定していれば、そちらが使われます。
- 画面から直接APIキーを入力した場合は、その値を Worker 経由で Gemini に送信します。
- 途中で失敗しても、同じ入力のまま再実行すると保存済みフェーズから再開します。
