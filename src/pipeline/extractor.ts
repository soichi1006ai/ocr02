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
    const parsed = JSON.parse(jsonText);
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
