import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { pdf } from 'pdf-to-img';
import { PNG } from 'pngjs';

export async function convertPdfToImages(pdfPath: string, outputDir: string): Promise<string[]> {
  await mkdir(outputDir, { recursive: true });
  const document = await pdf(pdfPath, { scale: 3 });
  const filePaths: string[] = [];
  let pageNumber = 1;

  for await (const image of document) {
    const outputPath = join(outputDir, `${basename(pdfPath, extname(pdfPath))}_page_${String(pageNumber).padStart(3, '0')}.png`);
    await writeFile(outputPath, image);
    filePaths.push(outputPath);
    pageNumber += 1;
  }

  return filePaths;
}

export async function splitSpreadImage(imagePath: string): Promise<{ leftPath: string; rightPath: string }> {
  const source = PNG.sync.read(await readFile(imagePath));
  const halfWidth = Math.floor(source.width / 2);

  const left = new PNG({ width: halfWidth, height: source.height });
  const right = new PNG({ width: source.width - halfWidth, height: source.height });

  PNG.bitblt(source, left, 0, 0, halfWidth, source.height, 0, 0);
  PNG.bitblt(source, right, halfWidth, 0, source.width - halfWidth, source.height, 0, 0);

  const base = basename(imagePath, extname(imagePath));
  const parent = dirname(imagePath);
  const leftPath = join(parent, `${base}_left.png`);
  const rightPath = join(parent, `${base}_right.png`);

  await writeFile(leftPath, PNG.sync.write(left));
  await writeFile(rightPath, PNG.sync.write(right));

  return { leftPath, rightPath };
}
