import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import pRetry from 'p-retry';
import { loadPrompt } from '../prompt-loader.js';
import { Koyomi, KoyomiSchema } from '../domain/types.js';
import { ValidationError, validateKoyomi } from './validator.js';

const INPUT_COST_PER_MTOK = 15;
const OUTPUT_COST_PER_MTOK = 75;

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
    let previousResult = '';
    let previousErrors = '';
    let totalUsage: ExtractUsage = { input_tokens: 0, output_tokens: 0, cost_usd: 0 };
    let finalKoyomi: Koyomi | null = null;
    let finalErrors: ValidationError[] = [];
    let attempts = 0;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryLimit; attempt += 1) {
      attempts = attempt + 1;
      const promptName = attempt === 0 ? 'koyomi-extract.md' : 'koyomi-retry.md';
      const prompt = await loadPrompt(promptName, {
        ERRORS: previousErrors,
        PREVIOUS_RESULT: previousResult
      });

      try {
        const result = await this.extract(leftImagePath, rightImagePath, prompt);
        totalUsage = mergeUsage(totalUsage, result.usage);
        finalKoyomi = result.koyomi;
        finalErrors = validateKoyomi(result.koyomi);
        if (finalErrors.length === 0) {
          return { koyomi: result.koyomi, usage: totalUsage, validationErrors: [], attempts };
        }
        previousResult = JSON.stringify(result.koyomi, null, 2);
        previousErrors = finalErrors.map((error) => `- ${error.message}`).join('\n');
        lastError = null;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        previousErrors = `- JSON またはスキーマの解釈に失敗: ${lastError.message}`;
        previousResult = '';
      }
    }

    if (!finalKoyomi) {
      throw lastError ?? new Error('抽出結果が取得できませんでした。');
    }

    return { koyomi: finalKoyomi, usage: totalUsage, validationErrors: finalErrors, attempts };
  }

  async extract(leftImagePath: string, rightImagePath: string, prompt: string): Promise<{ koyomi: Koyomi; usage: ExtractUsage }> {
    const leftImageBase64 = await encodeImage(leftImagePath);
    const rightImageBase64 = await encodeImage(rightImagePath);

    const response = await pRetry(
      async () => this.client.messages.create({
        model: this.model,
        max_tokens: 20000,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: leftImageBase64 } },
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: rightImageBase64 } },
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
    const koyomi = KoyomiSchema.parse(parsed);
    const inputTokens = response.usage.input_tokens ?? 0;
    const outputTokens = response.usage.output_tokens ?? 0;

    return {
      koyomi,
      usage: {
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        cost_usd: calculateCostUsd(inputTokens, outputTokens)
      }
    };
  }
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
