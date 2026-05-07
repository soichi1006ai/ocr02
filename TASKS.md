# 暦表バッチ変換ツール タスクリスト

> **対象**: OpenAI Codex（実装担当）
> **前提**: `ARCHITECTURE.md` を必ず先に読むこと
> **進め方**: フェーズ順に実装、各タスクの受け入れ基準を満たして次へ

---

## 全体スケジュール

| フェーズ | 内容 | 想定時間 |
|---|---|---|
| 0 | リポジトリ初期化 | 1〜2h |
| 1 | ドメイン層実装 | 2〜3h |
| 2 | パイプライン層実装 | 4〜6h |
| 3 | CLI・設定・ログ | 2〜3h |
| 4 | テスト | 2〜3h |
| 5 | 実運用調整 | 適宜 |

---

# フェーズ 0: リポジトリ初期化

## T0.1: GitHub リポジトリ作成と初期化

**タスク**:
- [ ] 新規リポジトリを作成（リポジトリ名はマスターSが決定）
- [ ] `main` ブランチを作成、保護設定
- [ ] 開発は `feature/*` ブランチ → `main` への PR フローで実施
- [ ] README.md の雛形作成（実装後に詳細追記）

**受け入れ基準**:
- リポジトリが GitHub に存在する
- `git clone` できる

---

## T0.2: package.json と TypeScript 設定

**タスク**:
- [ ] `package.json` を作成、`"type": "module"` 設定
- [ ] `tsconfig.json` を作成（target: ES2022, module: NodeNext, strict: true）
- [ ] 必要なディレクトリ構造を作成（src/, tests/, output_samples/, _reference/）
- [ ] 依存パッケージのインストール:
  ```
  dependencies:
    @anthropic-ai/sdk
    pdf-to-img
    exceljs
    commander
    dotenv
    zod
    ora
    chalk
    p-retry
    p-limit
  
  devDependencies:
    typescript
    @types/node
    vitest
    tsx
  ```
- [ ] npm scripts 設定:
  ```
  "dev": "tsx src/index.ts"
  "build": "tsc"
  "start": "node dist/index.js"
  "test": "vitest"
  "test:run": "vitest run"
  ```

**受け入れ基準**:
- `npm install` がエラーなく完了する
- `npm run build` が型エラーなく成功する
- `tsx --version` が表示される

---

## T0.3: 環境変数とシークレット管理

**タスク**:
- [ ] `.env.example` を作成:
  ```
  ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
  KOYOMI_INPUT_DIR=
  KOYOMI_OUTPUT_DIR=
  ```
- [ ] `.gitignore` に以下を追加:
  ```
  node_modules/
  dist/
  .env
  *.log
  output/
  output_samples/_logs/
  ```
- [ ] README に「API キー設定方法」を記載

**受け入れ基準**:
- `.env` がリポジトリに含まれていない
- `.env.example` を見ればセットアップできる

---

## T0.4: 参照素材の配置

**タスク**:
- [ ] `_reference/` ディレクトリに以下を配置:
  - `make_2029_v2.py`（Web Claude 版の Python スクリプト、別途提供）
  - `prompt_design_notes.md`（Web Claude が確認した暦表構造のメモ）
- [ ] `output_samples/` に正解 Excel を配置:
  - `2029年己酉_暦表_v2.xlsx`
  - `2030年庚戌_暦表_v2.xlsx`
- [ ] `tests/fixtures/` にテスト用 PDF を配置:
  - `2029_己酉.pdf`
  - `2030_庚戌.pdf`

**受け入れ基準**:
- 全ファイルがリポジトリに存在する
- `output_samples/*.xlsx` が Excel で開ける

---

# フェーズ 1: ドメイン層実装

## T1.1: 型定義（src/domain/types.ts）

**タスク**:
- [ ] 以下の型を zod スキーマで定義:
  ```typescript
  Sekki: { name, date, time, type: "sekki" | "doou" }
  DayEntry: { day, kanshi, kyuusei_kanji, kyuusei_num }
  Month: { month, month_kanshi, kyoku, kyuusei, sekki, days }
  Koyomi: { year_label, year_kanshi, year_kyoku, year_kyuusei, months }
  ```
- [ ] zod スキーマから TypeScript 型を派生させる（`z.infer`）
- [ ] エクスポート: `KoyomiSchema`, `Koyomi` 型

**受け入れ基準**:
- 型エラーなくビルドできる
- 不正な JSON を `KoyomiSchema.parse()` でリジェクトできる

---

## T1.2: 干支60組（src/domain/kanshi.ts）

**タスク**:
- [ ] `KANSHI_60` 定数を `readonly string[]` で定義（甲子〜癸亥）
- [ ] `getKanshiIndex(kanshi: string): number` を実装
- [ ] `isKanshiContinuous(seq: string[]): boolean` を実装
- [ ] `getDaysInMonth(year: number, month: number): number` を実装（うるう年対応）

**受け入れ基準**:
- `KANSHI_60.length === 60`
- `getKanshiIndex("甲子") === 0`、`getKanshiIndex("癸亥") === 59`
- `isKanshiContinuous(["甲子", "乙丑"]) === true`
- `isKanshiContinuous(["甲子", "丙寅"]) === false`
- `isKanshiContinuous(["癸亥", "甲子"]) === true`（60→1の循環）
- `getDaysInMonth(2024, 2) === 29`（うるう年）

---

## T1.3: 九星パーサ（src/domain/kyuusei.ts）

**タスク**:
- [ ] `splitKyuusei(s: string): { kanji: string, num: number }` を実装
  - 例: `"火6"` → `{ kanji: "火", num: 6 }`
  - 例: `"水3"` → `{ kanji: "水", num: 3 }`
- [ ] 不正入力時は zod ValidationError を投げる
- [ ] `KYUUSEI_KANJI` 定数: `["日", "月", "火", "水", "木", "金", "土"]`

**受け入れ基準**:
- 全パターン（日1〜土9）でパース成功
- 不正入力（"hoge", "火A"）でエラー

---

## T1.4: 節気・土旺判定（src/domain/sekki.ts）

**タスク**:
- [ ] `isDoouMonth(month: number): boolean` を実装
  - 土旺月: 1, 4, 7, 10
- [ ] `getExpectedSekkiCount(month: number): number` を実装
  - 土旺月: 3、それ以外: 2
- [ ] `parseSekkiString(raw: string): Sekki` を実装（API レスポンスからパース）

**受け入れ基準**:
- `isDoouMonth(1) === true`、`isDoouMonth(2) === false`
- `getExpectedSekkiCount(1) === 3`、`getExpectedSekkiCount(2) === 2`

---

# フェーズ 2: パイプライン層実装

## T2.1: PDF→画像変換（src/pipeline/pdf-to-image.ts）

**タスク**:
- [ ] `pdf-to-img` を使って PDF の全ページを PNG に変換
- [ ] DPI: 300（精度確保）
- [ ] 関数シグネチャ:
  ```typescript
  async function convertPdfToImages(
    pdfPath: string,
    outputDir: string
  ): Promise<string[]>  // 生成された画像パスの配列
  ```
- [ ] 見開きスキャン1ページの場合、左右に分割する関数も追加:
  ```typescript
  async function splitSpreadImage(
    imagePath: string
  ): Promise<{ leftPath: string, rightPath: string }>
  ```
- [ ] 分割は中央線（width / 2）で物理的に切る

**受け入れ基準**:
- 2029年 PDF を入力すると 1 枚の PNG が生成される
- 分割すると左右 2 枚の PNG ができる
- 各画像が 300dpi 相当の解像度を持つ

---

## T2.2: Claude API 抽出（src/pipeline/extractor.ts）

**タスク**:
- [ ] `extractKoyomi(leftImagePath, rightImagePath): Promise<Koyomi>` を実装
- [ ] モデル: `claude-opus-4-7`
- [ ] Extended Thinking 有効化（budget_tokens: 4000）
- [ ] max_tokens: 8192
- [ ] プロンプトは `src/prompts/koyomi-extract.md` から読み込む
- [ ] レスポンスから JSON を抽出（マークダウンコードブロックも考慮）
- [ ] zod スキーマでバリデーション
- [ ] API エラー時は `p-retry` で指数バックオフリトライ（3回）
- [ ] トークン使用量とコストを返す:
  ```typescript
  interface ExtractResult {
    koyomi: Koyomi;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    };
  }
  ```

**受け入れ基準**:
- 2029年 PDF の画像で Koyomi 型のデータが返る
- API エラー時にリトライが働く
- コスト計算が正しい（Opus 4.7 価格表に基づく）

---

## T2.3: 検証ロジック（src/pipeline/validator.ts）

**タスク**:
- [ ] `validateKoyomi(koyomi: Koyomi): ValidationError[]` を実装
- [ ] チェック項目:
  1. 月の網羅性（1〜12月）
  2. 各月の日数
  3. 干支の連続性（全月連結）
  4. 節気の項目数
- [ ] エラーは `category` で分類:
  - `month_coverage`
  - `days_count`
  - `kanshi_continuity`
  - `sekki_count`

**受け入れ基準**:
- 正常データでエラー数 0
- 意図的に壊したデータで適切なカテゴリのエラー検出
- ARCHITECTURE.md §7.1 のインタフェースに準拠

---

## T2.4: 検証 NG 時のリトライ抽出

**タスク**:
- [ ] `extractWithValidation(...)` ラッパー関数を実装
- [ ] フロー:
  ```
  1. extractKoyomi() で抽出
  2. validateKoyomi() で検証
  3. エラーあり → koyomi-retry.md プロンプトで再抽出
  4. 最大 2 回までリトライ
  5. それでも NG → エラー詳細つきで結果返す（処理は継続）
  ```
- [ ] リトライプロンプトに以下を埋め込む:
  - 検証エラー一覧
  - 前回の出力結果（参考）

**受け入れ基準**:
- 1回目で成功する場合は1回のみ呼び出し
- 1回目NG, 2回目OKの場合は2回呼び出して成功
- 全リトライ失敗時もクラッシュしない

---

## T2.5: Excel 生成（src/pipeline/xlsx-builder.ts）

**タスク**:
- [ ] `buildXlsx(koyomi: Koyomi, outputPath: string): Promise<void>` を実装
- [ ] `_reference/make_2029_v2.py` を TypeScript + exceljs に移植
- [ ] 列構成: A列=日 / 各月3列(干支・九星漢字・数字) = 計37列
- [ ] スタイル:
  - フォント: Yu Mincho 11pt
  - ヘッダ: `#FFE7CE`
  - サブヘッダ: `#FFF4E0`
  - 日付列: `#F2F2F2`
  - 罫線: 全セル
- [ ] ヘッダ4行 + データ行31
- [ ] ウィンドウ枠固定: B6
- [ ] 列幅・行高は v2 の値を踏襲

**受け入れ基準**:
- 2029年データから生成した Excel が `output_samples/2029年己酉_暦表_v2.xlsx` と構造的に一致
- 開いたときに視覚的にほぼ同じ
- 日数が31未満の月（2月など）は「―」で埋める

---

# フェーズ 3: CLI・設定・ログ

## T3.1: 設定読み込み（src/config.ts）

**タスク**:
- [ ] ARCHITECTURE.md §9.1 の `resolveConfig()` を実装
- [ ] 3段フォールバック:
  1. CLI 引数（最優先）
  2. 環境変数
  3. デフォルト値
- [ ] デフォルトの自動探索:
  - `./book`
  - `~/Desktop/book`
- [ ] エラーメッセージは日本語で親切に

**受け入れ基準**:
- 引数なしで `~/Desktop/book` を発見できる
- `--input ~/Documents/abc/` で上書きできる
- 存在しないパス指定時は明確なエラー

---

## T3.2: CLI エントリ（src/index.ts）

**タスク**:
- [ ] `commander` で CLI を構築
- [ ] オプション:
  ```
  --input <path>           入力フォルダ
  --output <path>          出力フォルダ
  --concurrency <n>        並列度（デフォルト 3）
  --force                  既存出力を上書き
  --dry-run                API 呼ばずに見積もりのみ
  --help                   ヘルプ
  --version                バージョン
  ```
- [ ] メイン処理:
  1. 設定解決
  2. PDF ファイル一覧取得
  3. 出力済みスキップ判定（`--force` でなければ）
  4. `p-limit` で並列処理
  5. 各ファイル: PDF→画像→抽出→検証→Excel
  6. サマリー表示

**受け入れ基準**:
- `koyomi-batch --help` でヘルプ表示
- `koyomi-batch --dry-run` で API 呼ばずにファイル一覧と見積もり表示
- `koyomi-batch` でデフォルト動作

---

## T3.3: ロガー（src/logger.ts）

**タスク**:
- [ ] `chalk` + `ora` で進捗表示
- [ ] ARCHITECTURE.md §10.1 のフォーマットに沿った出力
- [ ] ファイル単位の進捗バー
- [ ] エラー時は赤、警告は黄、成功は緑
- [ ] サマリーロガー（最後の集計表示）
- [ ] JSON ログ書き出し（`output/_logs/*.json`）

**受け入れ基準**:
- 進捗が視覚的に分かる
- エラー時にファイル名・原因が明確
- 累積コストがリアルタイム表示

---

## T3.4: プロンプト管理（src/prompts/*.md）

**タスク**:
- [ ] `koyomi-extract.md` を作成（ARCHITECTURE.md §6.3 ベース）
- [ ] `koyomi-retry.md` を作成（同 §6.4 ベース）
- [ ] テンプレート展開機構を実装:
  ```typescript
  function loadPrompt(name: string, vars: Record<string, string>): string
  ```
  - `{ERRORS}`, `{PREVIOUS_RESULT}` などのプレースホルダ置換

**受け入れ基準**:
- プロンプトが Markdown として読み書きしやすい
- テンプレート展開が動く

---

# フェーズ 4: テスト

## T4.1: ドメイン層ユニットテスト

**タスク**:
- [ ] `tests/domain/kanshi.test.ts`:
  - 干支60組の長さ・順序
  - 連続性判定の正常・異常ケース
  - うるう年判定
- [ ] `tests/domain/sekki.test.ts`:
  - 土旺月判定
  - 期待節気数
- [ ] `tests/domain/kyuusei.test.ts`:
  - 九星パース全パターン

**受け入れ基準**:
- `npm run test:run` で全パス
- カバレッジ 90% 以上（domain 層）

---

## T4.2: 検証層テスト

**タスク**:
- [ ] `tests/pipeline/validator.test.ts`:
  - 正常データでエラー 0
  - 月欠落でエラー
  - 日数不足でエラー
  - 干支不連続でエラー
  - 節気数不一致でエラー

**受け入れ基準**:
- 各カテゴリのエラーが正しく検出される

---

## T4.3: 統合テスト（API モック）

**タスク**:
- [ ] `tests/e2e.test.ts`:
  - PDF → Excel の全フロー
  - API は `vi.mock()` でモック化
  - モックレスポンスは `tests/fixtures/2029_response.json` から
- [ ] 期待値と一致するか比較:
  - 生成 JSON が `2029_己酉_expected.json` と一致
  - Excel ファイルが生成される

**受け入れ基準**:
- 実 API を呼ばずに全フローが通る
- 期待値と一致

---

## T4.4: 受け入れテスト（実 API、手動）

**タスク**（実装完了後にマスターSと一緒に実施）:
- [ ] 2029年 PDF を投入 → Excel 生成
- [ ] 2030年 PDF を投入 → Excel 生成
- [ ] 生成された Excel を手動作成版（output_samples/）と比較
- [ ] 不一致があればプロンプト調整 → 再実行

**受け入れ基準**:
- 干支・九星・節気の値が一致
- レイアウトがほぼ同一

---

# フェーズ 5: 実運用調整

## T5.1: 11ファイル一括実行

**タスク**:
- [ ] マスターSが `~/Desktop/book/` に11ファイル配置
- [ ] `koyomi-batch` で全件実行
- [ ] 全ファイルが完走することを確認
- [ ] サマリー（成功数・コスト・所要時間）を確認

**受け入れ基準**:
- 11/11 成功
- コスト $5 以内
- 所要時間 30 分以内

---

## T5.2: 結果検証とフィードバック反映

**タスク**:
- [ ] 各 Excel をサンプリング検証（11ファイルのうち 3〜5 ファイル）
- [ ] 誤読パターンがあれば記録 → プロンプトに `common_misreads` として反映
- [ ] 必要なら再実行

**受け入れ基準**:
- マスターSが「使える品質」と判断する

---

## T5.3: README 完成

**タスク**:
- [ ] セットアップ手順
- [ ] 使い方（コマンド例）
- [ ] トラブルシューティング
- [ ] よくある質問
- [ ] スクリーンショット

**受け入れ基準**:
- 新規ユーザーが README だけで使い始められる

---

## T5.4: リリース

**タスク**:
- [ ] バージョン 1.0.0 を package.json に設定
- [ ] git tag v1.0.0
- [ ] GitHub Releases にリリースノート作成
- [ ] CHANGELOG.md 作成

**受け入れ基準**:
- v1.0.0 タグが main にある
- GitHub Releases に記載がある

---

# 付録 A: タスク間の依存関係

```
T0.1 → T0.2 → T0.3 → T0.4
                       ↓
T1.1 → T1.2, T1.3, T1.4 (並列可)
                       ↓
T2.1, T2.2 (並列可) → T2.3 → T2.4 → T2.5
                       ↓
T3.1 → T3.2 → T3.3 → T3.4
                       ↓
T4.1, T4.2, T4.3 (並列可) → T4.4
                       ↓
T5.1 → T5.2 → T5.3 → T5.4
```

---

# 付録 B: 受け入れ確認チェックリスト（最終リリース時）

- [ ] 全11ファイルが完走する
- [ ] 生成 Excel が手動作成版と構造的に一致
- [ ] 検証エラー時に自動リトライが動作
- [ ] API コスト $5 以内
- [ ] 中断後に再開可能（`--force` なしで未処理のみ実行）
- [ ] README.md でセットアップから実行までが理解できる
- [ ] テストが全てパス
- [ ] エラーメッセージが日本語で親切
- [ ] v1.0.0 タグが付いている

---

# 付録 C: Codex への発注時のテンプレート

各フェーズ着手時に Codex へ以下のテンプレートで指示：

```
@codex

タスク: TX.Y
参照: ARCHITECTURE.md §X.Y、TASKS.md TX.Y

実装内容:
（TASKS.md の「タスク」項目をコピペ）

受け入れ基準:
（TASKS.md の「受け入れ基準」項目をコピペ）

ブランチ: feature/tXY-名前
PR向け先: main

開始時にやること:
1. ARCHITECTURE.md の関連セクションを読む
2. 既存の関連コード・テストを確認
3. テストファースト：受け入れ基準をテストに落とす
4. 実装
5. PR 作成

完了報告:
- 変更ファイル一覧
- 受け入れ基準のチェック結果
- 次のタスクへの引き継ぎ事項
```

---

# 付録 D: 想定外への対応

| 事態 | 対応 |
|---|---|
| `pdf-to-img` が動かない | `pdfjs-dist` 直接利用に切り替え |
| Claude API のレート制限 | concurrency を 1 に下げる、リトライ間隔を伸ばす |
| 検証失敗が頻発 | プロンプトに `common_misreads` セクション追加、Extended Thinking budget 増 |
| Excel スタイルが完全再現できない | 構造優先、装飾は妥協可（マスターSと相談） |
| 日付計算でうるう年がずれる | テスト追加、`getDaysInMonth` を Date オブジェクトベースで再実装 |

---

以上。`ARCHITECTURE.md` と本書に従って実装を進めてください。
