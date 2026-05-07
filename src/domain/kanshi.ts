export const KANSHI_60 = [
  '甲子', '乙丑', '丙寅', '丁卯', '戊辰', '己巳', '庚午', '辛未', '壬申', '癸酉',
  '甲戌', '乙亥', '丙子', '丁丑', '戊寅', '己卯', '庚辰', '辛巳', '壬午', '癸未',
  '甲申', '乙酉', '丙戌', '丁亥', '戊子', '己丑', '庚寅', '辛卯', '壬辰', '癸巳',
  '甲午', '乙未', '丙申', '丁酉', '戊戌', '己亥', '庚子', '辛丑', '壬寅', '癸卯',
  '甲辰', '乙巳', '丙午', '丁未', '戊申', '己酉', '庚戌', '辛亥', '壬子', '癸丑',
  '甲寅', '乙卯', '丙辰', '丁巳', '戊午', '己未', '庚申', '辛酉', '壬戌', '癸亥'
] as const;

export function getKanshiIndex(kanshi: string): number {
  return KANSHI_60.indexOf(kanshi as (typeof KANSHI_60)[number]);
}

export function isKanshiContinuous(sequence: string[]): boolean {
  const indices = sequence.map(getKanshiIndex);
  if (indices.some((index) => index < 0)) return false;
  for (let i = 0; i < indices.length - 1; i += 1) {
    if (indices[i + 1] !== (indices[i] + 1) % 60) return false;
  }
  return true;
}

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}
