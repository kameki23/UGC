# UGC動画量産スタジオ

静的エクスポート対応（Next.js 14 + TypeScript + Tailwind）のUGC動画企画/デモ生成アプリです。  
**サーバ不要**・**GitHub Pages配信可能**な構成です。

## 重要な安全ポリシー

- 本ツールの生成物は「GitHub上への自動公開」ではなく、利用者がローカルへダウンロードして使う運用です。

- 本ツール出力は **AI生成コンテンツ** です（必ず開示してください）。
- **なりすまし・誤認誘導・詐欺目的** の利用は禁止です。
- 人物画像を使う場合は **本人の明示同意** が必要です。
- このツールは **欺瞞的な impersonation（成り代わり）をサポートしません**。

## 主な機能

- 3カラムUI（左:素材 / 中央:台本・言語・音声 / 右:シーン・バッチ生成）
- 常時表示の安全通知
- プロジェクト保存/復元
  - localStorage
  - JSONインポート/エクスポート
- アバター/人物アップロード + Identity Lock（ブラウザ内SHA-256ベース）
- 商品画像アップロード
- 衣装リファレンスアップロード
- シーンプリセット100件（`src/data/scene-presets.json`）
- TikTok Shop風の日本語台本テンプレ50件（`src/data/script-templates.json`）
- 言語切替（ja/en/ko/zh）
- 音声スタイル・自然話法調整（pause/breath/prosody/pitch）
- ブラウザ SpeechSynthesis フォールバック + Mock TTS Adapter 抽象化
- リップシンク用デモタイムラインメタデータ表示
- 5〜20本のバッチ生成デモキュー（進捗バー）
- 出力画角比率の選択（9:16 / 16:9）とレイアウト追従プレビュー
- ffmpegコマンド「プレビュー文字列」生成（GitHub Pages上で実行はしない）
- 生成動画は公開せずダウンロード利用（JSONレシピDL + プレースホルダmp4ダウンロード）
- Canvas合成プレビュー（<=60秒想定）

## セットアップ

```bash
npm install
npm run generate:data
npm run dev
```

## ビルド / エクスポート

```bash
npm run build
npm run export
```

`next.config.mjs` で `output: 'export'` を設定済みのため、静的ファイルを `out/` に出力します。

## GitHub Pages 配備手順

1. リポジトリ作成してpush
2. Actionsを使う場合は Next.js static export を Pages にデプロイ（`out/` を公開）
3. もしくは `out/` を `gh-pages` ブランチへ配備
4. Pages設定でブランチ/フォルダを指定

> 注意: User/Project PagesのURLパスに応じて、必要なら `basePath` を `next.config.mjs` に追加してください。

## 商用利用の範囲と制約

- 商用利用自体は可能ですが、以下を遵守してください。
  - 配信プラットフォーム規約
  - 景表法・著作権・肖像権・個人情報保護
  - AI生成表記（必要な媒体で明示）
- 第三者の顔/音声/ブランドを無断で模倣する使い方は禁止
- 本アプリはデモ生成基盤であり、法的適合性の最終責任は利用者にあります

## データ生成スクリプト

```bash
npm run generate:data
```

- `src/data/scene-presets.json`（100件）
- `src/data/script-templates.json`（50件）

を再生成します。
