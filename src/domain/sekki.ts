import { Sekki, SekkiSchema } from './types.js';

const DOOU_MONTHS = new Set([1, 4, 7, 10]);

export function isDoouMonth(month: number): boolean {
  return DOOU_MONTHS.has(month);
}

export function getExpectedSekkiCount(month: number): number {
  return isDoouMonth(month) ? 3 : 2;
}

export function parseSekkiString(raw: string): Sekki {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  const match = trimmed.match(/^(\S+)\s+(\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})$/);
  if (!match) {
    throw new Error(`節気の形式が不正です: ${raw}`);
  }
  return SekkiSchema.parse({
    name: match[1],
    date: match[2],
    time: match[3],
    type: match[1] === '土旺' ? 'doou' : 'sekki'
  });
}
