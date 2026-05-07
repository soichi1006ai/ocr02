import { z } from 'zod';

export const SekkiSchema = z.object({
  name: z.string().min(1),
  date: z.string().regex(/^\d{1,2}\/\d{1,2}$/),
  time: z.string().regex(/^\d{1,2}:\d{2}$/),
  type: z.enum(['sekki', 'doou'])
});

export const DayEntrySchema = z.object({
  day: z.number().int().min(1).max(31),
  kanshi: z.string().min(2),
  kyuusei_kanji: z.string().min(1).max(1),
  kyuusei_num: z.number().int().min(1).max(9)
});

export const MonthSchema = z.object({
  month: z.number().int().min(1).max(12),
  month_kanshi: z.string().min(2),
  kyoku: z.string().min(1),
  kyuusei: z.string().min(1),
  sekki: z.array(SekkiSchema),
  days: z.array(DayEntrySchema)
});

export const KoyomiSchema = z.object({
  year_label: z.string().min(1),
  year_kanshi: z.string().min(2),
  year_kyoku: z.string().min(1),
  year_kyuusei: z.string().min(1),
  months: z.array(MonthSchema).length(12)
});

export type Sekki = z.infer<typeof SekkiSchema>;
export type DayEntry = z.infer<typeof DayEntrySchema>;
export type Month = z.infer<typeof MonthSchema>;
export type Koyomi = z.infer<typeof KoyomiSchema>;
