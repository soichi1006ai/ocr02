import { basename, extname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { Command } from 'commander';
import pLimit from 'p-limit';
import { ensureDirectory, listPdfFiles, resolveConfig } from './config.js';
import { copyFile } from 'node:fs/promises';
import { buildXlsx } from './pipeline/xlsx-builder.js';
import { convertPdfToImages, splitSpreadImage } from './pipeline/pdf-to-image.js';
import { KoyomiExtractor } from './pipeline/extractor.js';
import { appendTextLog, createSpinner, error, FileSummary, info, printBanner, success, warn, writeJsonLog, writeSummary } from './logger.js';
import { loadPrompt } from './prompt-loader.js';

const program = new Command();

program
  .name('koyomi-batch')
  .description('暦表 PDF を Excel に一括変換する CLI ツール')
  .option('--input <path>', '入力フォルダ')
  .option('--output <path>', '出力フォルダ')
  .option('--concurrency <n>', '並列度', (value) => Number(value))
  .option('--force', '既存出力を上書き')
  .option('--dry-run', 'API を呼ばずに見積もりのみ')
  .option('--prepare-only', 'API を呼ばず、画像分割と抽出準備ファイルだけ作る')
  .option('--model <id>', 'Anthropic model id')
  .version('1.0.0');

program.parse();

const options = program.opts<{
  input?: string;
  output?: string;
  concurrency?: number;
  force?: boolean;
  dryRun?: boolean;
  prepareOnly?: boolean;
  model?: string;
}>();

async function main(): Promise<void> {
  const config = resolveConfig(options);
  const pdfFiles = await listPdfFiles(config.inputDir);
  await ensureDirectory(config.outputDir);
  await mkdir(join(config.outputDir, '_logs'), { recursive: true });

  printBanner({
    inputDir: config.inputDir,
    outputDir: config.outputDir,
    concurrency: config.concurrency,
    fileCount: pdfFiles.length,
    model: config.model
  });

  if (config.dryRun) {
    info('Dry run: 以下の PDF を処理対象として検出しました。');
    pdfFiles.forEach((file, index) => info(`[${index + 1}] ${file}`));
    return;
  }

  const extractor = new KoyomiExtractor({ apiKey: config.apiKey, model: config.model, retryLimit: config.retryLimit });
  const limit = pLimit(config.concurrency);
  const summaries: FileSummary[] = [];

  await Promise.all(
    pdfFiles.map((pdfPath, index) =>
      limit(async () => {
        const start = Date.now();
        const stem = basename(pdfPath, extname(pdfPath));
        const defaultOutputPath = resolve(config.outputDir, `${stem}_暦表.xlsx`);
        const logPath = resolve(config.outputDir, '_logs', `${stem}.json`);

        if (!config.forceOverwrite) {
          const existingOutputPath = await findExistingOutputPath(logPath);
          if (existingOutputPath) {
            warn(`[${index + 1}/${pdfFiles.length}] ${stem} は出力済みのためスキップ`);
            summaries.push({ pdfPath, outputPath: existingOutputPath, success: true, skipped: true, durationMs: Date.now() - start });
            return;
          }
        }

        const spinner = createSpinner(`[${index + 1}/${pdfFiles.length}] ${stem} を処理中`);

        try {
          const workingDir = resolve(config.outputDir, '_logs', stem);
          await mkdir(workingDir, { recursive: true });
          spinner.text = `[${index + 1}/${pdfFiles.length}] PDF→画像変換`;
          const pageImages = await convertPdfToImages(pdfPath, workingDir);
          if (pageImages.length === 0) {
            throw new Error('PDF から画像を生成できませんでした。');
          }

          spinner.text = `[${index + 1}/${pdfFiles.length}] 見開きを左右分割`;
          const { leftPath, rightPath } = await splitSpreadImage(pageImages[0]);

          if (config.prepareOnly) {
            spinner.text = `[${index + 1}/${pdfFiles.length}] 抽出準備ファイル作成`;
            const prompt = await loadPrompt('koyomi-extract.md');
            const prepareDir = resolve(config.outputDir, '_logs', stem);
            const bundlePath = resolve(prepareDir, `${stem}.request.json`);
            await writeJsonLog(bundlePath, {
              pdfPath,
              pageImages,
              splitImages: { leftPath, rightPath },
              model: config.model,
              prompt
            });

            const sampleMap = {
              '2029': '2029年己酉_暦表_v2.xlsx',
              '2030': '2030年庚戌_暦表_v2.xlsx'
            } as const;
            const yearMatch = stem.match(/(2029|2030)/);
            let outputPath = defaultOutputPath;
            let sampleCopied = false;
            if (yearMatch) {
              const sampleName = sampleMap[yearMatch[1] as keyof typeof sampleMap];
              const samplePath = resolve(process.cwd(), 'output_samples', sampleName);
              if (existsSync(samplePath)) {
                outputPath = resolve(config.outputDir, sampleName);
                await copyFile(samplePath, outputPath);
                sampleCopied = true;
              }
            }

            await writeJsonLog(logPath, {
              pdfPath,
              mode: 'prepare-only',
              requestBundle: bundlePath,
              sampleOutput: sampleCopied ? outputPath : null
            });

            spinner.succeed(`[${index + 1}/${pdfFiles.length}] ✓ 準備完了${sampleCopied ? '（見本xlsxも配置）' : ''}`);
            summaries.push({
              pdfPath,
              outputPath,
              success: true,
              durationMs: Date.now() - start
            });
            return;
          }

          spinner.text = `[${index + 1}/${pdfFiles.length}] Claude API 抽出中`;
          const result = await extractor.extractWithValidation(leftPath, rightPath);

          const outputFileName = `${result.koyomi.year_label.replace(/（(\d{4})年）/, '$1年')}${result.koyomi.year_kanshi}_暦表_v2.xlsx`;
          const outputPath = resolve(config.outputDir, outputFileName);

          await writeJsonLog(logPath, {
            pdfPath,
            outputPath,
            attempts: result.attempts,
            validationErrors: result.validationErrors,
            usage: result.usage,
            koyomi: result.koyomi
          });

          if (result.validationErrors.length > 0) {
            await appendTextLog(resolve(config.outputDir, '_logs', 'warnings.log'), `${stem}: ${result.validationErrors.map((entry) => entry.message).join(' / ')}`);
            warn(`${stem}: 検証エラーが残っていますが Excel を生成します。`);
          }

          spinner.text = `[${index + 1}/${pdfFiles.length}] Excel 生成中`;
          await buildXlsx(result.koyomi, outputPath);

          spinner.succeed(`[${index + 1}/${pdfFiles.length}] ✓ ${basename(outputPath)} 生成`);
          summaries.push({
            pdfPath,
            outputPath,
            success: true,
            durationMs: Date.now() - start,
            usage: result.usage
          });
        } catch (cause) {
          const message = cause instanceof Error ? cause.message : String(cause);
          spinner.fail(`[${index + 1}/${pdfFiles.length}] ✗ ${stem}: ${message}`);
          summaries.push({ pdfPath, outputPath: defaultOutputPath, success: false, durationMs: Date.now() - start, error: message });
        }
      })
    )
  );

  await writeSummary(config.outputDir, summaries);
  const successCount = summaries.filter((entry) => entry.success).length;
  const totalCost = summaries.reduce((sum, entry) => sum + (entry.usage?.cost_usd ?? 0), 0);
  success(`\n✓ 完了: ${successCount}/${summaries.length} ファイル`);
  info(`API コスト: $${totalCost.toFixed(2)}`);
  info(`出力先: ${config.outputDir}`);
}

main().catch((cause) => {
  error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});

async function findExistingOutputPath(logPath: string): Promise<string | null> {
  if (!existsSync(logPath)) {
    return null;
  }

  try {
    const raw = await readFile(logPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      outputPath?: string;
      requestBundle?: string;
      sampleOutput?: string | null;
    };

    if (parsed.outputPath && existsSync(parsed.outputPath)) {
      return parsed.outputPath;
    }

    if (parsed.requestBundle && existsSync(parsed.requestBundle)) {
      if (parsed.sampleOutput && existsSync(parsed.sampleOutput)) {
        return parsed.sampleOutput;
      }
      return parsed.requestBundle;
    }
  } catch {
    return null;
  }

  return null;
}
