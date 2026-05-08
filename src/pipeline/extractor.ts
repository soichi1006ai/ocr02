import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import pRetry from 'p-retry';
import { loadPrompt } from '../prompt-loader.js';
import { Koyomi, KoyomiHalf, KoyomiHalfSchema } from '../domain/types.js';
import { ValidationError, validateKoyomi } from './validator.js';

const INPUT_COST_PER_MTOK = 15;
const OUTPUT_COST_PER_MTOK = 75;

// 右ページ（前半月）: 2〜7月、左ページ（後半月）: 1月・8〜12月
const RIGHT_MONTHS = new Set([2, 3, 4, 5, 6, 7]);

export interface ExtractUsage {
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

export interface ExtractResult {
  koyomi: Koyomi;
  usage: ExtractUsage;
  validationErrors: ValidationError[];
  attempts: number;
}

export interface ExtractorOptions {
  apiKey: string;
  model: string;
  retryLimit?: number;
}

export class KoyomiExtractor {
  private client: Anthropic;
  private retryLimit: number;
  private model: string;

  constructor(options: ExtractorOptions) {
    this.client = new Anthropic({ apiKey: options.apiKey });
    this.retryLimit = options.retryLimit ?? 2;
    this.model = options.model;
  }

  async extractWithValidation(leftImagePath: string, rightImagePath: string): Promise<ExtractResult> {
    let rightPrev = '';
    let leftPrev = '';
    let rightErrors = '';
    let leftErrors = '';
    let totalUsage: ExtractUsage = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    let finalKoyomi: Koyomi | null = null;
    let finalErrors: ValidationError[] = [];
    let attempts = 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryLimit; attempt += 1) {
      attempts = attempt + 1;
      const isRetry = attempt > 0;

      const [rightPrompt, leftPrompt] = await Promise.all([
        loadPrompt(isRetry ? 'koyomi-retry-right.md' : 'koyomi-extract-right.md', {
          ERRORS: rightErrors,
          PREVIOUS_RESULT: rightPrev
        }),
        loadPrompt(isRetry ? 'koyomi-retry-left.md' : 'koyomi-extract-left.md', {
          ERRORS: leftErrors,
          PREVIOUS_RESULT: leftPrev
        })
      ]);

      try {
        const [rightResult, leftResult] = await Promise.all([
          this.extractHalf(rightImagePath, rightPrompt),
          this.extractHalf(leftImagePath, leftPrompt)
        ]);

        totalUsage = mergeUsage(totalUsage, mergeUsage(rightResult.usage, leftResult.usage));

        const merged = mergeHalves(rightResult.half, leftResult.half);
        finalKoyomi = merged;
        finalErrors = validateKoyomi(merged);

        if (finalErrors.length === 0) {
          return { koyomi: merged, usage: totalUsage, validationErrors: [], attempts };
        }

        rightPrev = JSON.stringify(rightResult.half, null, 2);
        leftPrev = JSON.stringify(leftResult.half, null, 2);
        const { right: rErrs, left: lErrs } = splitErrorsByPage(finalErrors);
        rightErrors = rErrs.map((e) => `- ${e.message}`).join('\n');
        leftErrors = lErrs.map((e) => `- ${e.message}`).join('\n');
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        const msg = `- JSON またはスキーマの解釈に失敗: ${lastError.message}`;
        rightErrors = msg;
        leftErrors = msg;
        rightPrev = '';
        leftPrev = '';
      }
    }

    if (!finalKoyomi) {
      throw lastError ?? new Error('抽出結果が取得できませんでした。');
    }

    return { koyomi: finalKoyomi, usage: totalUsage, validationErrors: finalErrors, attempts };
  }

  private async extractHalf(imagePath: string, prompt: string): Promise<{ half: KoyomiHalf; usage: ExtractUsage }> {
    const imageBase64 = await encodeImage(imagePath);

    const response = await pRetry(
      async () => this.client.messages.create({
        model: this.model,
        max_tokens: 10000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageBase64 } },
              { type: 'text', text: prompt }
            ]
          }
        ]
      }),
      { retries: 2 }
    );

    const rawText = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim();

    const jsonText = extractJson(rawText);
    const parsed = normalizeRaw(JSON.parse(jsonText));
    const half = KoyomiHalfSchema.parse(parsed);
    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens ?? 0;

    return {
      half,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: calculateCostUsd(inputTokens, outputTokens)
      }
    };
  }
}

function mergeHalves(right: KoyomiHalf, left: KoyomiHalf): Koyomi {
  const allMonths = [...right.months, ...left.months].sort((a, b) => a.month - b.month);
  return {
    year_label: right.year_label || left.year_label,
    year_kanshi: right.year_kanshi || left.year_kanshi,
    year_kyoku: right.year_kyoku || left.year_kyoku,
    year_kyuusei: right.year_kyuusei || left.year_kyuusei,
    months: allMonths
  } as Koyomi;
}

function splitErrorsByPage(errors: ValidationError[]): { right: ValidationError[]; left: ValidationError[] } {
  const right: ValidationError[] = [];
  const left: ValidationError[] = [];
  for (const err of errors) {
    if (err.category === 'kanshi_continuity') {
      right.push(err);
      left.push(err);
      continue;
    }
    const match = err.message.match(/^(\d+)月/);
    const month = match ? Number(match[1]) : null;
    if (month === null) {
      right.push(err);
      left.push(err);
    } else if (RIGHT_MONTHS.has(month)) {
      right.push(err);
    } else {
      left.push(err);
    }
  }
  return { right, left };
}

export function extractJson(rawText: string): string {
  const fenced = rawText.match(/```json\s*([\s\S]*?)```/i) ?? rawText.match(/```\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  const start = rawText.indexOf('{');
  const end = rawText.lastIndexOf('}');
  if (start >= 0 && end > start) return rawText.slice(start, end + 1);
  throw new Error('JSON をレスポンスから抽出できませんでした。');
}

async function encodeImage(path: string): Promise<string> {
  const buffer = await readFile(path);
  return buffer.toString('base64');
}

function calculateCostUsd(inputTokens: number, outputTokens: number): number {
  return Number((((inputTokens / 1_000_000) * INPUT_COST_PER_MTOK) + ((outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK)).toFixed(4));
}

function mergeUsage(a: ExtractUsage, b: ExtractUsage): ExtractUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cost_usd: Number((a.cost_usd + b.cost_usd).toFixed(4))
  };
}

// Claudeが返すJSONの表記ゆれをZodパース前に正規化する
function normalizeRaw(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.months)) return raw;

  obj.months = obj.months.map((month: unknown) => {
    if (!month || typeof month !== 'object') return month;
    const m = { ...(month as Record<string, unknown>) };

    if (Array.isArray(m.sekki)) {
      m.sekki = m.sekki.map((s: unknown) => {
        if (!s || typeof s !== 'object') return s;
        const sk = { ...(s as Record<string, unknown>) };

        // type: "土旺"→"doou"、それ以外の不明値→"sekki"
        if (sk.type !== 'sekki' && sk.type !== 'doou') {
          sk.type = String(sk.type ?? '').includes('土') ? 'doou' : 'sekki';
        }

        // date: 全角→半角、"X月X日"→"X/X"
        if (typeof sk.date === 'string') sk.date = normalizeDate(sk.date);

        // time: 全角→半角、"X時X分"→"X:XX"、秒除去
        if (typeof sk.time === 'string') sk.time = normalizeTime(sk.time);

        return sk;
      });
    }

    if (Array.isArray(m.days)) {
      m.days = m.days.map((d: unknown) => {
        if (!d || typeof d !== 'object') return d;
        const day = { ...(d as Record<string, unknown>) };

        // kyuusei_kanji: "火6"のように数字込みの場合は漢字部分だけ取り出す
        if (typeof day.kyuusei_kanji === 'string' && day.kyuusei_kanji.length > 1) {
          day.kyuusei_kanji = day.kyuusei_kanji.replace(/\d/g, '').slice(0, 1);
        }

        // kyuusei_num: 文字列・漢数字・範囲外を正規化
        day.kyuusei_num = normalizeKyuuseiNum(day.kyuusei_num);

        return day;
      });
    }

    return m;
  });

  return obj;
}

function normalizeDate(date: string): string {
  // 全角数字・スラッシュ → 半角
  date = date.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));
  date = date.replace(/[／]/g, '/');
  // "1月5日" → "1/5"
  const jp = date.match(/(\d{1,2})月(\d{1,2})日/);
  if (jp) return `${jp[1]}/${jp[2]}`;
  // "2/10" を文字列中から抽出（余分なテキストや時刻が混入している場合）
  const slash = date.match(/(\d{1,2})\/(\d{1,2})/);
  if (slash) return `${slash[1]}/${slash[2]}`;
  // "2-10" / "2.10" → "2/10"
  const sep = date.match(/^(\d{1,2})[-.](\d{1,2})$/);
  if (sep) return `${sep[1]}/${sep[2]}`;
  return date;
}

function normalizeTime(time: string): string {
  if (!time) return time;
  // 全角数字・コロン → 半角
  time = time.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFF10 + 0x30));
  time = time.replace(/[：]/g, ':');
  // "16時31分" → "16:31"
  const jp = time.match(/(\d{1,2})時(\d{1,2})分/);
  if (jp) return `${jp[1]}:${jp[2].padStart(2, '0')}`;
  // "16:31:00" → "16:31"（秒除去）
  const withSec = time.match(/^(\d{1,2}:\d{2}):\d{2}$/);
  if (withSec) return withSec[1];
  // "16.31" などセパレータ違い → "16:31"
  const dotSep = time.match(/^(\d{1,2})[.\-](\d{2})$/);
  if (dotSep) return `${dotSep[1]}:${dotSep[2]}`;
  // 埋め込み数字から HH:MM を抽出（"約16:31" など）
  const embedded = time.match(/(\d{1,2})[：:](\d{2})/);
  if (embedded) return `${embedded[1]}:${embedded[2]}`;
  // 1桁分 "8:3" → "8:03"
  const singleMin = time.match(/^(\d{1,2}):(\d)$/);
  if (singleMin) return `${singleMin[1]}:0${singleMin[2]}`;
  // 4桁数字 "1631" → "16:31"
  const digits = time.replace(/\D/g, '');
  if (digits.length === 4) return `${digits.slice(0, 2)}:${digits.slice(2)}`;
  if (digits.length === 3) return `${digits[0]}:${digits.slice(1)}`;
  return time;
}

const KANJI_NUM: Record<string, number> = { 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };

function normalizeKyuuseiNum(raw: unknown): number {
  if (typeof raw === 'number') {
    // 範囲外（0や負数）は1にクランプ
    return Math.max(1, Math.min(9, Math.round(raw)));
  }
  if (typeof raw === 'string') {
    // 半角数字を探す
    const digit = raw.match(/[1-9]/);
    if (digit) return Number(digit[0]);
    // 漢数字を探す
    for (const [k, v] of Object.entries(KANJI_NUM)) {
      if (raw.includes(k)) return v;
    }
  }
  return 1; // fallback
}
