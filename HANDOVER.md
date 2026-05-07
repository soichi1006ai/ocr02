# Codex への引き継ぎサマリ

> **作成日**: 2026-05-08
> **作成者**: Web Claude（Opus 4.7）+ マスターS
> **対象**: OpenAI Codex（ChatGPT のコーディングエージェント）

---

## このファイルを最初に読むこと

このプロジェクトは以下の3点セットで構成されている：

1. **`ARCHITECTURE.md`** ─ 設計思想・モジュール構成・データフロー
2. **`TASKS.md`** ─ フェーズ別タスクリスト・受け入れ基準
3. **`HANDOVER.md`** ─ 本ファイル（コンテキストと指示書）

実装着手前に、上記3ファイルすべてを読むこと。

---

## 1. プロジェクトの背景（5行サマリー）

マスターSは江戸時代〜現代の暦表 PDF（11ファイル、合計91MB）を Excel 化したい。
Web Claude では2ファイル変換済みで正解フォーマット確定済み。
残り9ファイルもアップロードして処理するのは Pro 枠的に厳しい。
そこでローカル PC で Claude API を直接叩く Node.js CLI ツールを作る。
このツールは `~/Desktop/book/` の PDF を一括処理する。

---

## 2. 重要な決定事項（マスターS確認済み）

| 項目 | 決定 |
|---|---|
| 言語 | TypeScript 5.x |
| ランタイム | Node.js 20 LTS |
| API モデル | claude-opus-4-7（精度最優先） |
| Extended Thinking | 有効（budget_tokens: 4000） |
| 並列度 | 3（デフォルト） |
| パス指定 | 3段フォールバック（CLI > env > デフォルト） |
| リポジトリ | 別リポジトリ（名前は後で決定） |
| 出力フォーマット | v2 形式（節気3項目対応、九星3列分割） |

---

## 3. マスターSの開発規律（厳守）

- **1 issue → 1 branch → 1 PR**
- **言語分離**: 会話は日本語、コードは英語
- **Mac 開発環境**
- **既存ワークフロー**: GitHub PR → Vercel 自動デプロイ（このプロジェクトは Vercel 関係なし）

---

## 4. 既に検証済みの内容

### 4.1 正解フォーマット
Web Claude が手作業で2ファイル変換済み：
- `output_samples/2029年己酉_暦表_v2.xlsx`
- `output_samples/2030年庚戌_暦表_v2.xlsx`（未生成、必要なら作成）

実装ではこの v2 形式を**完全再現**すること。

### 4.2 Web Claude が確認した暦表構造の知見

これは ARCHITECTURE.md §1 にも書いたが、重要なので再掲：

1. **見開きスキャンの読み順**: 縦書き古文書のため右→左
   - 左ページ: 8月〜1月（後半月、右→左）
   - 右ページ: 2月〜7月（前半月、右→左）
   - 出力時は時系列順（1月→12月）に並べ替える

2. **干支60組**: 連続性が成立する（前日の翌が今日）

3. **九星**: `単位漢字 + 数字`（例: `火6`、`木3`）

4. **節気**:
   - 通常月: 2項目
   - 土旺月（1/4/7/10）: 3項目（土旺を中央に）

5. **月盤**: `月干支 + 局 + 九星`（例: `丁丑 陰9局 6白`）

---

## 5. 着手手順

### ステップ1: リポジトリ作成
```bash
# マスターSが GitHub で新規リポジトリ作成
# 名前は後で決定、仮: koyomi-batch

git clone https://github.com/soichi1006ai/koyomi-batch.git
cd koyomi-batch
```

### ステップ2: 設計書を配置
```bash
# ARCHITECTURE.md, TASKS.md, HANDOVER.md をコミット
git add ARCHITECTURE.md TASKS.md HANDOVER.md
git commit -m "docs: initial architecture and tasks"
git push origin main
```

### ステップ3: 参照素材の配置
```bash
# Web Claude が作成した Python スクリプトを参照用に配置
mkdir -p _reference
cp /path/to/make_2029_v2.py _reference/

# Excel 正解サンプルを配置
mkdir -p output_samples
cp /path/to/2029年己酉_暦表_v2.xlsx output_samples/

# テスト用 PDF を配置
mkdir -p tests/fixtures
cp /path/to/2029_己酉.pdf tests/fixtures/
cp /path/to/2030_庚戌.pdf tests/fixtures/
```

### ステップ4: タスクリストに従って実装
TASKS.md のフェーズ0から順に着手。フェーズを飛ばさない。

---

## 6. API キーの取得と設定

```bash
# .env.example （リポジトリにコミット）
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxx
KOYOMI_INPUT_DIR=
KOYOMI_OUTPUT_DIR=

# 実際の .env （.gitignore 済み）
cp .env.example .env
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

**重要**: 実装着手前に Anthropic Console で月額使用上限を設定（推奨 $20/月）。

---

## 7. 本ドキュメントとの不整合があった場合

優先順位:
1. **マスターSの指示** が最優先
2. **ARCHITECTURE.md** の設計思想
3. **TASKS.md** の具体的タスク
4. **本ファイル**

不整合に気づいたら作業を止めて確認すること。

---

## 8. よくある罠（先回り注意）

### 8.1 Claude API の構造化出力
`response_format: json_object` のような機能は**Anthropic API にはない**。
プロンプトで「JSON のみ返せ」と指示し、コード側で堅牢にパースする必要がある。

```typescript
// よくあるレスポンス形式（マークダウンコードブロック付き）
const text = response.content[0].text;
const cleaned = text.replace(/^```json\s*/, "").replace(/\s*```$/, "").trim();
const parsed = JSON.parse(cleaned);
const validated = KoyomiSchema.parse(parsed); // zod でバリデーション
```

### 8.2 Extended Thinking の仕様
```typescript
const response = await anthropic.messages.create({
  model: "claude-opus-4-7",
  max_tokens: 8192,           // budget_tokens + 出力想定 以上
  thinking: {
    type: "enabled",
    budget_tokens: 4000,      // 思考に使うトークン数
  },
  messages: [...]
});
```

`max_tokens` は `budget_tokens + 出力想定トークン` 以上必要。

### 8.3 画像サイズ制限
Claude API の画像上限は **5MB**。300dpi で見開き PDF を変換すると超える可能性あり。
- 必要なら JPEG 変換（PNG → JPEG で約 1/5 になる）
- ただし精度が落ちる可能性があるので最初は PNG で試す

### 8.4 pdf-to-img のメモリ
大きな PDF だとメモリを食う。同時に複数ファイル処理する場合は注意。
`p-limit` で並列度 3 に制限しているので大丈夫なはず。

### 8.5 ESM と CommonJS の混在
package.json で `"type": "module"` 必須。
import 文には拡張子を付ける（`import x from "./foo.js"` ※ .ts ではない）。

---

## 9. テストデータ

### 9.1 fixtures
```
tests/fixtures/
├─ 2029_己酉.pdf      ← Web Claude で検証済み
├─ 2030_庚戌.pdf      ← Web Claude で検証済み
├─ 2029_response.json ← API モック用
├─ 2030_response.json ← API モック用
└─ 2029_己酉_expected.json ← 期待値
```

### 9.2 期待値の作り方
1. Web Claude（claude.ai）に PDF をアップロード
2. ARCHITECTURE.md §6.3 のプロンプトをそのまま投入
3. 返ってきた JSON を `tests/fixtures/` に保存
4. 目視で確認・修正

---

## 10. リリース時の最終チェックリスト

v1.0.0 リリース前の確認項目：

- [ ] 11ファイル一括実行で全件成功
- [ ] 生成 Excel が手動作成版と構造的に一致
- [ ] 検証エラー時の自動リトライが動作
- [ ] API コスト $5 以内
- [ ] 中断後に再開可能
- [ ] README.md / ARCHITECTURE.md / TASKS.md が最新
- [ ] .env が gitignore されている
- [ ] テスト全パス
- [ ] エラーメッセージが日本語で親切
- [ ] v1.0.0 タグが付いている
- [ ] GitHub Releases にリリースノート

---

## 11. 補足: Web Claude が取得済みの情報

すでにマスターSと Web Claude のあいだで合意した内容：

- 暦表は 2 種類のフォーマット候補があったが、**v2 形式（節気3項目、九星3列分割）を採用**
- ファイル単位の並列処理。同時実行数 3
- 出力は `<入力フォルダ>/output/` 配下
- 中間生成物（PNG、JSON ログ）は `output/_logs/` 配下

これらは ARCHITECTURE.md にも明記してある。Codex は ARCHITECTURE.md を信頼すること。

---

## 12. マスターSの連絡

実装中の判断に迷ったら、PR コメント or Issue でマスターSに確認。
DonCorleone エコシステム経由で同期される。

---

## 13. 終わりに

このツールはマスターSの暦表変換業務を**長期的に支える基盤**。
スピードよりも品質と保守性を優先すること。

各フェーズで丁寧に検証してから次に進むこと。

頑張れ、Codex。
