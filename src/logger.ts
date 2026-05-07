import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import chalk from 'chalk';
import ora, { Ora } from 'ora';

export interface FileSummary {
  pdfPath: string;
  outputPath: string;
  success: boolean;
  skipped?: boolean;
  durationMs: number;
  error?: string;
  usage?: { input_tokens: number; output_tokens: number; cost_usd: number };
}

export function printBanner(config: { inputDir: string; outputDir: string; concurrency: number; fileCount: number; model: string }): void {
  console.log(chalk.cyan('🌙 暦表バッチ変換ツール v1.0.0'));
  console.log(chalk.gray('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log(`入力: ${config.inputDir}`);
  console.log(`出力: ${config.outputDir}`);
  console.log(`モデル: ${config.model}`);
  console.log(`並列度: ${config.concurrency}`);
  console.log(`対象ファイル: ${config.fileCount}`);
  console.log('');
}

export function createSpinner(text: string): Ora {
  return ora({ text, spinner: 'dots' }).start();
}

export function info(message: string): void {
  console.log(message);
}

export function success(message: string): void {
  console.log(chalk.green(message));
}

export function warn(message: string): void {
  console.log(chalk.yellow(message));
}

export function error(message: string): void {
  console.log(chalk.red(message));
}

export async function writeJsonLog(path: string, payload: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function appendTextLog(path: string, line: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, `${line}\n`, 'utf8');
}

export async function writeSummary(outputDir: string, files: FileSummary[]): Promise<void> {
  const totalCost = files.reduce((sum, file) => sum + (file.usage?.cost_usd ?? 0), 0);
  const successCount = files.filter((file) => file.success).length;
  await writeJsonLog(resolve(outputDir, '_logs/summary.json'), {
    generatedAt: new Date().toISOString(),
    successCount,
    totalCount: files.length,
    totalCostUsd: Number(totalCost.toFixed(4)),
    files
  });
}
