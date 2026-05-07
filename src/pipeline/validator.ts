import { Koyomi } from '../domain/types.js';
import { getDaysInMonth, isKanshiContinuous } from '../domain/kanshi.js';
import { getExpectedSekkiCount } from '../domain/sekki.js';

export interface ValidationError {
  level: 'error' | 'warning';
  category: 'month_coverage' | 'days_count' | 'kanshi_continuity' | 'sekki_count';
  message: string;
  context?: unknown;
}

export function parseWesternYear(yearLabel: string): number {
  const match = yearLabel.match(/（(\d{4})年）/) ?? yearLabel.match(/\b(\d{4})年\b/);
  if (!match) {
    throw new Error(`西暦を year_label から解釈できません: ${yearLabel}`);
  }
  return Number(match[1]);
}

export function validateKoyomi(koyomi: Koyomi): ValidationError[] {
  const errors: ValidationError[] = [];
  const months = [...koyomi.months].sort((a, b) => a.month - b.month);
  const found = new Set(months.map((month) => month.month));

  for (let month = 1; month <= 12; month += 1) {
    if (!found.has(month)) {
      errors.push({ level: 'error', category: 'month_coverage', message: `${month}月が欠落` });
    }
  }

  const year = parseWesternYear(koyomi.year_label);

  for (const month of months) {
    const expectedDays = getDaysInMonth(year, month.month);
    if (month.days.length !== expectedDays) {
      errors.push({
        level: 'error',
        category: 'days_count',
        message: `${month.month}月の日数が ${month.days.length}（期待値 ${expectedDays}）`,
        context: { month: month.month, expectedDays, actualDays: month.days.length }
      });
    }

    const expectedSekkiCount = getExpectedSekkiCount(month.month);
    if (month.sekki.length !== expectedSekkiCount) {
      errors.push({
        level: 'error',
        category: 'sekki_count',
        message: `${month.month}月の節気項目数が ${month.sekki.length}（期待値 ${expectedSekkiCount}）`,
        context: { month: month.month, expectedSekkiCount, actualSekkiCount: month.sekki.length }
      });
    }
  }

  const kanshiSequence = months.flatMap((month) =>
    [...month.days].sort((a, b) => a.day - b.day).map((day) => day.kanshi)
  );

  if (!isKanshiContinuous(kanshiSequence)) {
    errors.push({
      level: 'error',
      category: 'kanshi_continuity',
      message: '干支の連続性に異常'
    });
  }

  return errors;
}
