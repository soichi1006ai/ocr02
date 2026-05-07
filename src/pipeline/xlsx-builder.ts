import ExcelJS from 'exceljs';
import { Koyomi } from '../domain/types.js';
import { getDaysInMonth } from '../domain/kanshi.js';
import { parseWesternYear } from './validator.js';

const HEADER_FILL = 'FFFFE7CE';
const SUBHEADER_FILL = 'FFFFF4E0';
const DAY_FILL = 'FFF2F2F2';
const THIN = { style: 'thin' as const, color: { argb: 'FF000000' } };

export async function buildXlsx(koyomi: Koyomi, outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(`${parseWesternYear(koyomi.year_label)}年(${koyomi.year_kanshi})`, {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 5, topLeftCell: 'B6' }]
  });

  const months = [...koyomi.months].sort((a, b) => a.month - b.month);
  const year = parseWesternYear(koyomi.year_label);
  const totalColumns = 37;

  sheet.mergeCells(1, 1, 1, totalColumns);
  const title = `${koyomi.year_label}${koyomi.year_kanshi}（${koyomi.year_kyoku}・${koyomi.year_kyuusei}）暦表`;
  const titleCell = sheet.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { name: 'Yu Mincho', size: 14, bold: true };
  titleCell.alignment = { horizontal: 'center', vertical: 'middle' };

  const a2 = sheet.getCell(2, 1);
  a2.value = '日';
  styleCell(a2, { bold: true, fill: HEADER_FILL });

  const a3 = sheet.getCell(3, 1);
  a3.value = '月盤';
  styleCell(a3, { bold: true, fill: SUBHEADER_FILL });

  const a4 = sheet.getCell(4, 1);
  a4.value = '節気';
  styleCell(a4, { bold: true, fill: SUBHEADER_FILL });

  styleCell(sheet.getCell(5, 1), { fill: SUBHEADER_FILL });

  months.forEach((month, index) => {
    const startCol = 2 + index * 3;
    const endCol = startCol + 2;

    sheet.mergeCells(2, startCol, 2, endCol);
    sheet.mergeCells(3, startCol, 3, endCol);
    sheet.mergeCells(4, startCol, 4, endCol);

    const monthCell = sheet.getCell(2, startCol);
    monthCell.value = `${month.month}月`;
    styleCell(monthCell, { bold: true, fill: HEADER_FILL });

    const boardCell = sheet.getCell(3, startCol);
    boardCell.value = `${month.month_kanshi} ${month.kyoku} ${month.kyuusei}`;
    styleCell(boardCell, { fill: SUBHEADER_FILL });

    const sekkiCell = sheet.getCell(4, startCol);
    sekkiCell.value = month.sekki.map((sekki) => `${sekki.name} ${sekki.date} ${sekki.time}`).join('\n');
    styleCell(sekkiCell, { fill: SUBHEADER_FILL, wrapText: true });

    const labels = ['干支', '九星', '数'];
    labels.forEach((label, offset) => {
      const cell = sheet.getCell(5, startCol + offset);
      cell.value = label;
      styleCell(cell, { bold: true, fill: SUBHEADER_FILL });
    });

    for (let day = 1; day <= 31; day += 1) {
      const row = 5 + day;
      if (index === 0) {
        const dayCell = sheet.getCell(row, 1);
        dayCell.value = day;
        styleCell(dayCell, { bold: true, fill: DAY_FILL });
      }
      const entry = month.days.find((item) => item.day === day);
      const values = day > getDaysInMonth(year, month.month)
        ? ['―', '―', '―']
        : [entry?.kanshi ?? '', entry?.kyuusei_kanji ?? '', entry?.kyuusei_num ?? ''];
      values.forEach((value, offset) => {
        const cell = sheet.getCell(row, startCol + offset);
        cell.value = value as string | number;
        styleCell(cell);
      });
    }
  });

  sheet.getColumn(1).width = 5;
  for (let i = 0; i < 12; i += 1) {
    const col = 2 + i * 3;
    sheet.getColumn(col).width = 6.5;
    sheet.getColumn(col + 1).width = 4.5;
    sheet.getColumn(col + 2).width = 4.0;
  }

  sheet.getRow(1).height = 26;
  sheet.getRow(2).height = 22;
  sheet.getRow(3).height = 22;
  sheet.getRow(4).height = 56;
  sheet.getRow(5).height = 18;
  for (let row = 6; row <= 36; row += 1) {
    sheet.getRow(row).height = 18;
  }

  await workbook.xlsx.writeFile(outputPath);
}

function styleCell(
  cell: ExcelJS.Cell,
  options: { bold?: boolean; fill?: string; wrapText?: boolean } = {}
): void {
  cell.font = { name: 'Yu Mincho', size: 11, bold: options.bold ?? false };
  cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: options.wrapText ?? true };
  cell.border = { top: THIN, left: THIN, bottom: THIN, right: THIN };
  if (options.fill) {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: options.fill } };
  }
}
