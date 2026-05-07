# 暦表バッチ変換ツール 設計書

> **発注先**: OpenAI Codex（ChatGPT のコーディングエージェント）
> **作成日**: 2026-05-08
> **作成者**: マスターS + Web Claude（Opus 4.7）
> **想定実装期間**: 1〜2日
> **ペアドキュメント**: `TASKS.md`（タスクリスト）

---

## 0. このプロジェクトの全体像

### 0.1 やりたいこと

ローカル PC のフォルダにある暦表 PDF（11ファイル、合計約91MB）を、**1つのコマンドで一括的に Excel 化する** Node.js CLI ツールを作る。

- **入力**: 見開きスキャンの PDF（1ファイル＝1年分の暦表）
- **処理**: Claude API（claude-opus-4-7）で構造化抽出 → Excel 生成
- **出力**: 各 PDF と同じディレクトリ階層の `output/` 配下に `.xlsx` ファイル

### 0.2 なぜ Web Claude ではなく API ローカル処理か

合計 91MB を Web Claude（claude.ai）にアップロードするのは現実的ではない（Pro 枠枯渇、アップロードサイズ問題、再利用性ゼロ）。
ローカルで Claude API を直接呼べば、コスト約 **$3〜5**、再利用可能、1時間以内に完了する。

### 0.3 既に検証済みの事項

Web Claude で2ファイル分（2029年・2030年）を実際に変換し、**正解フォーマットを確定済み**。
このツールはその変換ロジックを11ファイルに自動適用する。

正解フォーマットの実物：
- `/output_samples/2029年己酉_暦表_v2.xlsx`
- `/output_samples/2030年庚戌_暦表.xlsx`（後で v2 形式へ変換予定）

実装ではこの v2 形式を必ず再現すること。

---

## 1. 暦表の構造（ドメイン知識）

### 1.1 暦表とは何か

平成・昭和等の元号で記された見開き1ページに**1年分の暦**が載っている表。各日について干支と九星が記載され、各月の節気・土旺の時刻情報も含まれる。

### 1.2 物理レイアウト（PDF の見た目）

```
[左ページ]                              [右ページ]
┌──────────────────────────┐ ┌──────────────────────────┐
│ 1月  12月  11月  10月  9月  8月│ │ 7月  6月  5月  4月  3月  2月│
│ 干支  干支  干支  干支  干支  干支 │ │ 干支  干支  干支  干支  干支  干支│
│ 九星  九星  九星  九星  九星  九星 │ │ 九星  九星  九星  九星  九星  九星│
└──────────────────────────┘ └──────────────────────────┘
```

**重要**: 縦書き古文書のため**右→左の順**で読む。月の物理位置と論理順序（時系列）は対応関係を変換する必要がある。

### 1.3 出力 Excel の論理レイアウト（時系列順）

```
[1シート]
┌─────────────────────────────────────────────┐
│ タイトル: 平成XX年（YYYY年）干支（局・九星）暦表    │
├──┬───┬───┬───┬───┬─...┬───┤
│日│1月 │2月 │3月 │4月 │   │12月│
├──┼───┼───┼───┼───┼─...┼───┤
│  │月盤│月盤│月盤│月盤│   │月盤│
├──┼───┼───┼───┼───┼─...┼───┤
│  │節気│節気│節気│節気│   │節気│  (土旺月は3項目)
├──┼─┬─┬─┼─┬─┬─┼...┼─┬─┬─┤
│  │干│九│数│干│九│数│   │干│九│数│ (見出し行)
├──┼─┼─┼─┼─┼─┼─┼...┼─┼─┼─┤
│ 1│..│..│..│..│..│..│   │..│..│..│
│ 2│..│..│..│..│..│..│   │..│..│..│
│..│..│..│..│..│..│..│   │..│..│..│
│31│..│..│..│..│..│..│   │..│..│..│
└──┴─┴─┴─┴─┴─┴─┴...┴─┴─┴─┘
```

### 1.4 各セルの内容仕様

#### 干支（kanshi）
- 60組の循環: 甲子、乙丑、丙寅、… 癸亥
- 連続性が成立する（前日の翌が今日）
- 月をまたいでも連続

#### 九星（kyuusei）
- 単位漢字（日 / 月 / 火 / 水 / 木 / 金 / 土）+ 数字（1〜9）
- 例: `火6`, `木3`, `日4`
- Excel 出力では「九星(漢字)」と「数字」を**別列に分割**する

#### 節気（sekki）
- 通常月: 2項目（月初・月末）
- **土旺月**（1月・4月・7月・10月）: 3項目（節気1 / 土旺 / 節気2）
- フォーマット: `節気名 月/日 時:分`
- 例: `小寒 1/5 16:31`、`土旺 1/17 11:10`、`大寒 1/20 9:54`

#### 月盤（getsuban）
- 月干支 + 局（陰X局/陽X局）+ 九星
- 例: `丁丑 陰9局 6白`

### 1.5 検証ルール（出力の妥当性チェック）

抽出後に必ず以下を検証する：

1. **月の網羅性**: 1〜12月すべてが揃っているか
2. **日数チェック**: 各月の日数が正しいか（1月=31、2月=28/29、…）
3. **干支の連続性**: 全日連結したとき60組の循環順序になっているか
4. **節気の項目数**: 通常月は2項目、土旺月（1/4/7/10）は3項目あるか

検証 NG なら自動的にプロンプトを調整して再抽出（最大2回）。

---

## 2. 設計思想

### 2.1 シンプル＆堅牢を優先

このツールは**単発の業務用**であり、大規模システムを目指さない。
ただし以下は譲れない：

- **全11ファイルがエラーなく完走する** → リトライ機構必須
- **問題が起きたファイルだけ再実行可能** → ファイル単位の独立性
- **処理途中で中断しても再開できる** → 出力済みファイルはスキップ
- **進捗が見える** → リアルタイム表示

### 2.2 「処理パイプライン」と「ドメインロジック」を分離

```
[Pipeline 層]                [Domain 層]
PDF読み込み                   暦表のJSON仕様
画像化                        干支60組
API呼び出し                   九星パターン
JSON解析                      節気の月別パターン（土旺月の判定）
Excel生成                     検証ロジック（連続性・網羅性）
```

ドメインロジックは別モジュール化し、テストしやすく・将来別の年代・別の暦表種類に拡張しやすくする。

### 2.3 設定の3段フォールバック（堅牢性確保）

PDF フォルダのパス指定は以下の優先順位で解決する：

```
1. CLI 引数:    --input <path>          ← 最優先（明示的）
2. 環境変数:    KOYOMI_INPUT_DIR        ← 中位（プロジェクト固有設定）
3. デフォルト:  ./book または ~/Desktop/book を自動検出
```

これにより「引数指定し忘れ → 何も起きない」という事故を防ぎつつ、**誰でも何も指定せずに実行できる**状態を作る。

---

## 3. ディレクトリ構成

```
koyomi-batch/                       ← リポジトリルート（名前は仮）
├─ src/
│   ├─ index.ts                     ← CLI エントリ
│   ├─ pipeline/
│   │   ├─ pdf-to-image.ts          ← PDF → PNG 変換
│   │   ├─ extractor.ts             ← Claude API で構造化抽出
│   │   ├─ validator.ts             ← 出力の妥当性検証
│   │   └─ xlsx-builder.ts          ← Excel 生成
│   ├─ domain/
│   │   ├─ types.ts                 ← 型定義（Koyomi, Month, Day…）
│   │   ├─ kanshi.ts                ← 干支60組の知識
│   │   ├─ kyuusei.ts               ← 九星の分割ロジック
│   │   └─ sekki.ts                 ← 節気・土旺月の判定
│   ├─ prompts/
│   │   ├─ koyomi-extract.md        ← 抽出用プロンプト
│   │   └─ koyomi-retry.md          ← 再抽出用プロンプト
│   ├─ config.ts                    ← 設定読み込み（CLI/env/default）
│   └─ logger.ts                    ← 進捗・エラーログ
│
├─ tests/
│   ├─ fixtures/
│   │   ├─ 2029_己酉.pdf            ← Web Claude で検証済みのテストデータ
│   │   ├─ 2029_己酉_expected.json
│   │   └─ 2030_庚戌_expected.json
│   ├─ domain.test.ts
│   ├─ validator.test.ts
│   └─ e2e.test.ts
│
├─ output_samples/                  ← Web Claude 版の正解 Excel
│   ├─ 2029年己酉_暦表_v2.xlsx
│   └─ 2030年庚戌_暦表_v2.xlsx
│
├─ ARCHITECTURE.md                  ← 本書
├─ TASKS.md                         ← タスクリスト
├─ README.md                        ← 使い方
├─ .env.example                     ← API キー雛形
├─ .gitignore
├─ package.json
├─ tsconfig.json
└─ vitest.config.ts                 ← テスト設定
```

---

## 4. 技術スタック

### 4.1 採用技術と選定理由

| 領域 | 採用 | 理由 |
|---|---|---|
| 言語 | TypeScript 5.x | 型安全、将来の拡張性 |
| ランタイム | Node.js 20 LTS | 安定版、ESM完全対応 |
| Claude SDK | `@anthropic-ai/sdk` | 公式SDK |
| PDF→画像変換 | `pdf-to-img`（pure JS） | poppler 等の外部依存不要、Mac/Win/Linux で動く |
| Excel 生成 | `exceljs` | スタイル・結合セル対応 |
| 引数パース | `commander` | 堅牢、ヘルプ自動生成 |
| 環境変数 | `dotenv` | 標準デファクト |
| バリデーション | `zod` | 実行時 + 静的型 |
| 進捗表示 | `ora` + `chalk` | 単一ファイル進捗用 |
| テスト | `vitest` | 高速、ESM ネイティブ |
| リトライ | `p-retry` | 指数バックオフ実装済み |
| 並列制御 | `p-limit` | 同時実行数制御 |

### 4.2 採用しないもの

- **`pdf2pic`**: GraphicsMagick / poppler が必須で OS 依存性が高い
- **`sharp`**: ネイティブビルド必要で Codex 環境で問題が起きやすい
- **バッチ API**: 結果待ちが最大 24 時間。今回は対話的処理を優先

---

## 5. データフロー

### 5.1 全体フロー

```
[スタート]
    │
    ▼
入力フォルダのスキャン
    │  (例: ~/Desktop/book/*.pdf を見つける)
    ▼
出力フォルダの準備
    │  (./output/ または引数指定)
    ▼
ファイル単位の処理ループ（同時実行数 = 3）
    │
    ├─ 出力済みチェック → スキップ
    │
    ├─ PDF → PNG 変換（300dpi）
    │
    ├─ 左右ページ分割（綴じ目で切る）
    │
    ├─ Claude API（claude-opus-4-7）で構造化抽出
    │   └─ Extended Thinking 有効、JSON 出力指定
    │
    ├─ 妥当性検証
    │   └─ NG → リトライ（最大2回、エラー情報を含めたプロンプトで再送）
    │
    ├─ Excel 生成（v2 フォーマット）
    │
    └─ 完了ログ
    │
    ▼
全件サマリー（成功・失敗・コスト・所要時間）
```

### 5.2 並列実行制御

11 ファイルを順次処理すると遅い。同時に走らせすぎると API レート制限に引っかかる。
**同時実行数 = 3** をデフォルトとする（`p-limit` で制御）。

### 5.3 再開可能性（resumability）

各ファイルは独立処理。出力ファイルの存在で完了判定する：

```
[1] 2029年.pdf  → 2029年己酉_暦表.xlsx 存在 → スキップ
[2] 2030年.pdf  → 出力なし → 処理する
...
```

**完全再実行**したいときは `--force` フラグで上書き可能とする。

---

## 6. Claude API 呼び出し仕様

### 6.1 モデル選定

- **claude-opus-4-7**（マスターS指定）
- 古文書・縦書き・複雑な表構造のため最高精度モデルを使用
- Extended Thinking 有効（budget_tokens: 4000）

### 6.2 リクエスト構造

```typescript
const response = await anthropic.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 8192,
  thinking: {
    type: "enabled",
    budget_tokens: 4000,
  },
  messages: [
    {
      role: "user",
      content: [
        // 左ページ（後半月）
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: leftPageBase64 },
        },
        // 右ページ（前半月）
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: rightPageBase64 },
        },
        // プロンプト
        {
          type: "text",
          text: extractPrompt,
        },
      ],
    },
  ],
});
```

### 6.3 プロンプト設計（src/prompts/koyomi-extract.md）

**完全版は実装時に決定するが、必ず以下の要素を含めること**：

```markdown
# Task

これは江戸時代〜現代の【暦表（こよみ）】の見開きスキャン画像です。
**2枚の画像**として渡されます。
- 1枚目: 左ページ（縦書きで後半月: 8月〜1月が右→左に並ぶ）
- 2枚目: 右ページ（縦書きで前半月: 2月〜7月が右→左に並ぶ）

ただし**出力 JSON では時系列順（1月〜12月）に並べ替える**こと。

# 文書の構造

各月について以下が記載されている：
- 月名（1月〜12月）
- 月盤（月干支 + 局 + 九星）例: 「丁丑 陰9局 6白」
- 節気欄（通常月: 2項目、1月/4月/7月/10月: 土旺を含む3項目）
- 各日（1〜31）の干支と九星

# ドメイン知識

## 干支60組（必ずこの順序で循環）
甲子, 乙丑, 丙寅, 丁卯, 戊辰, 己巳, 庚午, 辛未, 壬申, 癸酉,
甲戌, 乙亥, 丙子, 丁丑, 戊寅, 己卯, 庚辰, 辛巳, 壬午, 癸未,
甲申, 乙酉, 丙戌, 丁亥, 戊子, 己丑, 庚寅, 辛卯, 壬辰, 癸巳,
甲午, 乙未, 丙申, 丁酉, 戊戌, 己亥, 庚子, 辛丑, 壬寅, 癸卯,
甲辰, 乙巳, 丙午, 丁未, 戊申, 己酉, 庚戌, 辛亥, 壬子, 癸丑,
甲寅, 乙卯, 丙辰, 丁巳, 戊午, 己未, 庚申, 辛酉, 壬戌, 癸亥

## 九星
- 単位漢字: 日, 月, 火, 水, 木, 金, 土
- 数字: 1〜9
- 表記: "火6", "水3" など

## 節気のフォーマット
- 通常月（2/3/5/6/8/9/11/12月）: 2項目
- 土旺月（1月/4月/7月/10月）: 3項目（土旺を中央に）

# 出力フォーマット（JSON のみ、説明文不要）

{
  "year_label": "平成41年（2029年）",
  "year_kanshi": "己酉",
  "year_kyoku": "陰7局",
  "year_kyuusei": "7赤",
  "months": [
    {
      "month": 1,
      "month_kanshi": "丁丑",
      "kyoku": "陰9局",
      "kyuusei": "6白",
      "sekki": [
        {"name": "小寒", "date": "1/5", "time": "16:31", "type": "sekki"},
        {"name": "土旺", "date": "1/17", "time": "11:10", "type": "doou"},
        {"name": "大寒", "date": "1/20", "time": "9:54", "type": "sekki"}
      ],
      "days": [
        {"day": 1, "kanshi": "丙申", "kyuusei_kanji": "火", "kyuusei_num": 6},
        {"day": 2, "kanshi": "丁酉", "kyuusei_kanji": "水", "kyuusei_num": 7}
      ]
    }
  ]
}

# 厳守ルール

1. 月は必ず1月〜12月の昇順
2. 各月の days は1日からその月の末日まで全て埋める
3. 干支は60組の順序を守る（順序が崩れていたら誤読を疑い再確認）
4. 不確定な文字は "[?]" で囲む（推測で埋めない）
5. 土旺は1月・4月・7月・10月にのみ存在する
6. JSON 以外（マークダウンコードブロックを含む）は出力しない
```

### 6.4 リトライ時のプロンプト（src/prompts/koyomi-retry.md）

検証エラーの内容を含めて再送する：

```markdown
前回の抽出結果に以下の問題がありました：

{ERRORS}

問題箇所を中心に再抽出してください。特に：
- 干支の連続性が崩れている場合は、画像を再度よく見て確認
- 月の日数が合わない場合は、見落としや余分なエントリがないか確認
- 節気の項目数が違う場合は、土旺月（1/4/7/10）の判定を見直す

前回の出力（参考）：
{PREVIOUS_RESULT}

正しい JSON で再出力してください。
```

---

## 7. 検証ロジック仕様

### 7.1 src/pipeline/validator.ts

```typescript
import { Koyomi } from "../domain/types.js";
import { isKanshiContinuous, getDaysInMonth } from "../domain/kanshi.js";

export interface ValidationError {
  level: "error" | "warning";
  category: "month_coverage" | "days_count" | "kanshi_continuity" | "sekki_count";
  message: string;
  context?: any;
}

export function validateKoyomi(koyomi: Koyomi): ValidationError[] {
  const errors: ValidationError[] = [];

  // 1. 月の網羅性
  const monthsFound = new Set(koyomi.months.map((m) => m.month));
  for (let i = 1; i <= 12; i++) {
    if (!monthsFound.has(i)) {
      errors.push({
        level: "error",
        category: "month_coverage",
        message: `${i}月が欠落`,
      });
    }
  }

  // 2. 各月の日数
  const year = parseYear(koyomi.year_label); // "平成41年（2029年）" → 2029
  for (const m of koyomi.months) {
    const expected = getDaysInMonth(year, m.month);
    if (m.days.length !== expected) {
      errors.push({
        level: "error",
        category: "days_count",
        message: `${m.month}月の日数が ${m.days.length}（期待値 ${expected}）`,
      });
    }
  }

  // 3. 干支の連続性（全月連結）
  const allKanshi = koyomi.months
    .sort((a, b) => a.month - b.month)
    .flatMap((m) => m.days.map((d) => d.kanshi));
  if (!isKanshiContinuous(allKanshi)) {
    errors.push({
      level: "error",
      category: "kanshi_continuity",
      message: "干支の連続性に異常",
    });
  }

  // 4. 節気の項目数
  const doouMonths = new Set([1, 4, 7, 10]);
  for (const m of koyomi.months) {
    const expected = doouMonths.has(m.month) ? 3 : 2;
    if (m.sekki.length !== expected) {
      errors.push({
        level: "error",
        category: "sekki_count",
        message: `${m.month}月の節気項目数が ${m.sekki.length}（期待値 ${expected}）`,
      });
    }
  }

  return errors;
}
```

### 7.2 src/domain/kanshi.ts

```typescript
const KANSHI_60: readonly string[] = [
  "甲子", "乙丑", "丙寅", "丁卯", "戊辰", "己巳", "庚午", "辛未", "壬申", "癸酉",
  "甲戌", "乙亥", "丙子", "丁丑", "戊寅", "己卯", "庚辰", "辛巳", "壬午", "癸未",
  "甲申", "乙酉", "丙戌", "丁亥", "戊子", "己丑", "庚寅", "辛卯", "壬辰", "癸巳",
  "甲午", "乙未", "丙申", "丁酉", "戊戌", "己亥", "庚子", "辛丑", "壬寅", "癸卯",
  "甲辰", "乙巳", "丙午", "丁未", "戊申", "己酉", "庚戌", "辛亥", "壬子", "癸丑",
  "甲寅", "乙卯", "丙辰", "丁巳", "戊午", "己未", "庚申", "辛酉", "壬戌", "癸亥",
] as const;

export function getKanshiIndex(kanshi: string): number {
  return KANSHI_60.indexOf(kanshi);
}

export function isKanshiContinuous(seq: string[]): boolean {
  const indices = seq.map(getKanshiIndex);
  if (indices.includes(-1)) return false;
  for (let i = 0; i < indices.length - 1; i++) {
    const expectedNext = (indices[i] + 1) % 60;
    if (indices[i + 1] !== expectedNext) return false;
  }
  return true;
}

export function getDaysInMonth(year: number, month: number): number {
  // JavaScript の Date は month が 0-indexed
  return new Date(year, month, 0).getDate();
}
```

---

## 8. Excel 生成仕様

### 8.1 src/pipeline/xlsx-builder.ts

正解フォーマット（v2）を完全再現する：

- **列構成**: A列=日 / 各月3列(干支・九星漢字・数字) = 計37列
- **ヘッダ4行**:
  - 行1: タイトル
  - 行2: 月名（2列マージ → 3列マージに変更）
  - 行3: 月盤
  - 行4: 節気（土旺月は3項目を改行で連結）
  - 行5: 列見出し（干支/九星/数）
- **データ行**: 行6〜36（日1〜31）
- **スタイル**:
  - フォント: Yu Mincho 11pt
  - ヘッダ背景色: `#FFE7CE`
  - サブヘッダ背景色: `#FFF4E0`
  - 日付列背景色: `#F2F2F2`
  - 罫線: 全セル細線
- **ウィンドウ枠固定**: B6（日付列とヘッダ4行を固定）

実装は Web Claude が作成した `make_2029_v2.py` を **TypeScript + exceljs に移植**する。元コードは `output_samples/` を生成したスクリプトとして提供する。

---

## 9. 設定とパス解決

### 9.1 src/config.ts

```typescript
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";

dotenv.config();

export interface Config {
  inputDir: string;
  outputDir: string;
  apiKey: string;
  concurrency: number;
  forceOverwrite: boolean;
  retryLimit: number;
}

export function resolveConfig(cliOptions: any): Config {
  // 入力ディレクトリの3段フォールバック
  const inputDir =
    cliOptions.input ??
    process.env.KOYOMI_INPUT_DIR ??
    findDefaultInputDir();

  // 出力ディレクトリ
  const outputDir =
    cliOptions.output ??
    process.env.KOYOMI_OUTPUT_DIR ??
    resolve(inputDir, "output");

  // API キー
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY が設定されていません。.env を確認してください。");
  }

  return {
    inputDir: resolve(inputDir),
    outputDir: resolve(outputDir),
    apiKey,
    concurrency: cliOptions.concurrency ?? 3,
    forceOverwrite: cliOptions.force ?? false,
    retryLimit: 2,
  };
}

function findDefaultInputDir(): string {
  const candidates = [
    resolve(process.cwd(), "book"),
    resolve(homedir(), "Desktop/book"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "入力フォルダが見つかりません。--input <path> で指定するか、./book または ~/Desktop/book を作成してください。"
  );
}
```

### 9.2 CLI 仕様（src/index.ts の commander 定義）

```bash
# 基本（デフォルト動作）
$ koyomi-batch
  → ./book または ~/Desktop/book を自動探索
  → ./output/ または book/output/ に出力

# パス明示
$ koyomi-batch --input ~/Documents/暦表/ --output ~/Documents/暦表/excel/

# 上書き再実行
$ koyomi-batch --force

# 並列度調整
$ koyomi-batch --concurrency 1     # シリアル実行（デバッグ用）
$ koyomi-batch --concurrency 5     # 高速化

# ドライラン（API 呼ばない、ファイル一覧と見積もりだけ）
$ koyomi-batch --dry-run
```

---

## 10. ログとエラーハンドリング

### 10.1 標準出力のフォーマット

```
🌙 暦表バッチ変換ツール v1.0.0
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
入力: ~/Desktop/book/
出力: ~/Desktop/book/output/
モデル: claude-opus-4-7
並列度: 3
対象ファイル: 11

[ 1/11] 昭和75年.pdf
  ├─ PDF→画像変換 (300dpi) ✓ 1.2s
  ├─ Claude API 抽出中 (Opus 4.7)
  ├─ ✓ 抽出完了 (12.3s, 入力 4,521 tok, 出力 3,210 tok)
  ├─ ✓ 検証パス
  └─ ✓ 昭和75年_暦表.xlsx 生成 (0.3s)

[ 2/11] 昭和76年.pdf
  ├─ PDF→画像変換 (300dpi) ✓ 1.1s
  ├─ Claude API 抽出中 (Opus 4.7)
  ├─ ⚠ 検証失敗: 3月の日数が30（期待値 31）
  ├─ ↻ リトライ 1/2
  ├─ ✓ 検証パス
  └─ ✓ 昭和76年_暦表.xlsx 生成

...

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ 完了: 11/11 ファイル
所要時間: 8分23秒
API コスト: $3.42
出力先: ~/Desktop/book/output/
```

### 10.2 ファイルログ（output/_logs/）

各ファイルの詳細処理ログを `_logs/` 配下に JSON で残す：

```
output/
  ├─ 昭和75年_暦表.xlsx
  ├─ 昭和76年_暦表.xlsx
  ├─ ...
  └─ _logs/
      ├─ 昭和75年.json   ← 抽出結果（生 JSON）
      ├─ 昭和76.json
      └─ summary.json    ← 全体サマリー
```

これがあれば、Excel 生成だけ後でやり直せる（API 再呼び出し不要）。

---

## 11. コスト管理

### 11.1 Anthropic Console での月額上限設定

実装前にマスターSが Anthropic Console で月額上限を設定する：

- **推奨上限**: $20/月（このタスクは $3〜5 の見込み、余裕を持たせる）
- **アラート**: $10 で通知

### 11.2 コスト概算

```
1ファイル当たり:
- 入力: 約 5,000 トークン（画像2枚 + プロンプト）
- 出力: 約 3,500 トークン（JSON）

Opus 4.7 価格（2026年5月時点）:
- 入力: $15/MTok
- 出力: $75/MTok

1ファイル: (5,000 × 15 + 3,500 × 75) / 1,000,000 = $0.34
11ファイル: 約 $3.74

検証 NG 時のリトライを考慮しても上限 $5 程度
```

### 11.3 コスト表示

実行ログに累積コストをリアルタイム表示する。
最後にサマリーで「合計 $X.XX」を出す。

---

## 12. テスト戦略

### 12.1 ユニットテスト

- `domain/kanshi.test.ts`: 干支60組順序、連続性判定
- `domain/sekki.test.ts`: 土旺月判定
- `pipeline/validator.test.ts`: 各検証ルール

### 12.2 統合テスト（API モック）

実際の API は呼ばず、モックレスポンスで動作確認：

- `tests/e2e.test.ts`: PDF → Excel の全フロー（API 部分はモック）
- 期待値: `tests/fixtures/2029_己酉_expected.json` と一致

### 12.3 受け入れテスト（実 API、手動）

実装完了後にマスターS指示で実施：

- 2029年・2030年の PDF を投入
- 生成された Excel が `output_samples/` の手動作成版と一致するか確認
- 一致しない場合はプロンプト調整

---

## 13. 実装ロードマップ

詳細は `TASKS.md` 参照。大枠：

| フェーズ | 内容 | 想定 |
|---|---|---|
| 0 | リポジトリ初期化、依存設定 | 1〜2h |
| 1 | ドメイン層（型・干支・節気） | 2〜3h |
| 2 | パイプライン（PDF・抽出・検証・Excel） | 4〜6h |
| 3 | CLI、設定、ログ | 2〜3h |
| 4 | テスト | 2〜3h |
| 5 | 実運用での調整 | 適宜 |

合計: **1〜2日**（マスターSの確認時間含まず）

---

## 14. 完了の定義

このツールは以下が全て満たされたら完了：

1. `koyomi-batch` コマンドで 11 ファイルが完走する
2. 生成された Excel が `output_samples/` の正解と構造的に一致
3. 検証エラー時に自動リトライが動作する
4. API コストが $5 以内に収まる
5. README.md でセットアップから実行までが理解できる
6. テストが全てパスする

---

## 15. 将来の拡張案（Future Work）

このツールは「11ファイル変換」に最適化されているが、将来以下に拡張可能：

- 複数年代対応（江戸時代〜現代）
- 別の暦表種類（六曜暦、九星暦単独など）
- Web UI（Drag & Drop で投入）
- 既存 ocr リポジトリ（v2）との統合

ただし**今回は YAGNI**（必要になるまで作らない）原則で、シンプル維持を優先する。

---

## 16. Codex への発注時の注意点

### 16.1 Codex に渡す情報

1. このリポジトリ全体（ARCHITECTURE.md, TASKS.md, output_samples/, .env.example）
2. Web Claude 版の Python スクリプト（make_2029_v2.py）を `_reference/` に配置
3. テスト用 PDF（2029年・2030年）を `tests/fixtures/` に配置

### 16.2 Codex への指示テンプレート

```
このリポジトリは暦表 PDF を Excel に一括変換する Node.js CLI ツールです。

ARCHITECTURE.md と TASKS.md を読んでから着手してください。
特に以下を厳守：

1. TypeScript 5.x + Node.js 20 LTS
2. ESM（"type": "module" in package.json）
3. ドメイン層とパイプライン層の分離
4. 設定の3段フォールバック（CLI > env > default）
5. 各ファイル独立処理、再開可能性
6. 検証 NG 時の自動リトライ（最大2回）
7. output_samples/ の Excel フォーマットを完全再現

タスクは TASKS.md のフェーズ順に進めてください。
不明点があれば作業を止めて確認すること。
```

### 16.3 マスターSの規律（Codex に伝える）

- `1 issue → 1 branch → 1 PR` のワークフロー
- 言語分離: 会話は日本語、コードは英語
- Python 3.11.9（参考スクリプト用）
- Mac 開発環境

以上。

---

> 次は `TASKS.md` を読んで実装に着手してください。
