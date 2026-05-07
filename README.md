# koyomi-batch

暦表 PDF を Claude API で構造化抽出し、Excel に一括変換する Node.js CLI ツールです。

## セットアップ

```bash
npm install
cp .env.example .env
# .env に ANTHROPIC_API_KEY を設定
```

## 使い方

```bash
npm run dev -- --input ~/Desktop/book
npm run build
node dist/index.js --input ~/Desktop/book --output ~/Desktop/book/output
```

### APIなしで準備だけ進める

```bash
npm run dev -- --input ~/Desktop/book_test --prepare-only
```

これで以下を作ります。
- PDF→PNG 変換
- 見開きの左右分割画像
- API投入用の request bundle JSON
- 2029/2030 は見本xlsxも output に配置

### 主なオプション

- `--input <path>`: 入力フォルダ
- `--output <path>`: 出力フォルダ
- `--concurrency <n>`: 並列度（デフォルト 3）
- `--force`: 既存出力を上書き
- `--dry-run`: PDF 一覧だけ確認
- `--prepare-only`: APIを呼ばず、抽出準備ファイルだけ作る

## 入力フォルダの解決順

1. CLI 引数 `--input`
2. 環境変数 `KOYOMI_INPUT_DIR`
3. `./book` または `~/Desktop/book`

## 開発

```bash
npm run test:run
npm run build
```

## 既知の注意

- Excel レイアウトは設計書ベースの v2 実装です。最終的なサンプル一致確認は実データで要確認です。
- `output_samples/` と `_reference/` の参照素材が揃うと、見た目調整を詰めやすくなります。
