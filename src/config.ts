import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

export interface CliOptions {
  input?: string;
  output?: string;
  concurrency?: number;
  force?: boolean;
  dryRun?: boolean;
  prepareOnly?: boolean;
  model?: string;
}

export interface Config {
  inputDir: string;
  outputDir: string;
  apiKey: string;
  concurrency: number;
  forceOverwrite: boolean;
  retryLimit: number;
  dryRun: boolean;
  prepareOnly: boolean;
  model: string;
}

export async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function listPdfFiles(inputDir: string): Promise<string[]> {
  const entries = await readdir(inputDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.pdf'))
    .map((entry) => resolve(inputDir, entry.name))
    .sort((a, b) => a.localeCompare(b, 'ja'));
}

export function resolveConfig(options: CliOptions): Config {
  const inputDir = resolve(options.input ?? process.env.KOYOMI_INPUT_DIR ?? findDefaultInputDir());
  const outputDir = resolve(options.output ?? process.env.KOYOMI_OUTPUT_DIR ?? resolve(inputDir, 'output'));
  const apiKey = process.env.ANTHROPIC_API_KEY ?? '';

  if (!options.dryRun && !options.prepareOnly && !apiKey) {
    throw new Error('ANTHROPIC_API_KEY が設定されていません。.env を確認してください。');
  }

  return {
    inputDir,
    outputDir,
    apiKey,
    concurrency: options.concurrency ?? 3,
    forceOverwrite: options.force ?? false,
    retryLimit: 2,
    dryRun: options.dryRun ?? false,
    prepareOnly: options.prepareOnly ?? false,
    model: options.model ?? process.env.KOYOMI_MODEL ?? 'claude-opus-4-7'
  };
}

function findDefaultInputDir(): string {
  const candidates = [resolve(process.cwd(), 'book'), resolve(homedir(), 'Desktop/book')];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('入力フォルダが見つかりません。--input <path> を指定するか、./book または ~/Desktop/book を作成してください。');
  }
  return found;
}
