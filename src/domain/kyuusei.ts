import { z } from 'zod';

export const KYUUSEI_KANJI = ['日', '月', '火', '水', '木', '金', '土'] as const;

const KyuuseiInputSchema = z.string().regex(/^[日月火水木金土][1-9]$/);

export function splitKyuusei(input: string): { kanji: string; num: number } {
  KyuuseiInputSchema.parse(input);
  return {
    kanji: input.slice(0, 1),
    num: Number(input.slice(1))
  };
}
