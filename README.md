# UGC動画量産スタジオ

Next.js + TypeScript + Tailwind の **ダウンロード先行 (download-first)** UGC動画生成ワークフローです。  
静的エクスポート運用（GitHub Pages）とクラウド実生成モードの両方に対応します。

## 安全ポリシー（必読）

- 出力は **AI生成コンテンツ**。媒体要件に応じて開示してください。
- **本人同意のない人物利用は禁止**。
- **なりすまし / 誤認誘導 / 虚偽・欺瞞的訴求は禁止**。
- 本ツールは「高い自然さ」を目指しますが、検知回避や欺瞞行為を保証しません。

## 新機能（2026-02）

1. **生成モード追加**
   - 同一人物 + 同一商品（シーン変化）
   - 同一人物 + 商品差し替えリスト
   - 人物差し替え（任意）
2. **複数商品入力**（配列アップロード）
   - 商品画像を複数登録してループ生成
   - クイックプリセットで「人物固定・商品だけ差し替え」
3. **シナリオ本数コントロール**
   - 同一人物+同一商品モードで N 本生成
   - 個別DL + manifest(JSON) 一括DL
4. **台本モード**
   - exact（原文そのまま）
   - paraphrase（軽い自然リライト）
   - ja/en/ko/zh/fr/it のクライアント側テンプレート内蔵
5. **ジェスチャープラン生成**
   - hook/problem/solution/cta の4セグメント
   - セグメントごとの camera / gesture / expression / tempo をUI表示
   - recipeにメタデータとして同梱
6. **キュー生成時に変化モードを反映**
   - identity lockを維持する設定を適用
   - script variation と gesture plan を各アイテムへ展開
7. **UI改善（ポップ化）**
   - カラーカード/ボタン/余白調整
   - 日本語可読性を維持
8. **Cloud mode互換維持**
   - 既存クラウド生成フローを継続利用

## 使い方（推奨）

1. 左カラムで人物/商品/背景素材を登録
2. 必要なら人物IDロック作成（同意済みのみ）
3. 生成モードを選択
4. 台本モード（exact/paraphrase）と台本内容を確定
5. ジェスチャープランを生成
6. 右カラムでシーン・比率・本数を調整してキュー開始
7. 出力を個別DL、または manifest を一括DL

## クラウド実生成

必要に応じて以下を入力:

- ElevenLabs API Key
- ElevenLabs Voice ID
- Sync API Token
- (任意) Sync Model ID

> APIキーはブラウザ保存されるため、公開運用時は権限最小・短命キー推奨。

## セットアップ

```bash
npm install
npm run generate:data
npm run dev
```

## ビルド

```bash
npm run build
```

必要に応じて:

```bash
npm run export
```

## 補足

- zipライブラリ非導入のため、一括出力は manifest 形式で提供
- download-first設計のため、クラウド未返却時もローカルplaceholderで取得可能
- 法令/規約適合の最終責任は利用者側にあります
