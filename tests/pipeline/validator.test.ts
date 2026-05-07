import { describe, expect, it } from 'vitest';
import { KANSHI_60 } from '../../src/domain/kanshi.js';
import { Koyomi } from '../../src/domain/types.js';
import { validateKoyomi } from '../../src/pipeline/validator.js';

function createValidKoyomi(): Koyomi {
  let offset = 0;
  return {
    year_label: '平成41年（2029年）',
    year_kanshi: '己酉',
    year_kyoku: '陰7局',
    year_kyuusei: '7赤',
    months: Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const daysInMonth = new Date(2029, month, 0).getDate();
      const days = Array.from({ length: daysInMonth }, (_, dayIndex) => ({
        day: dayIndex + 1,
        kanshi: KANSHI_60[(offset + dayIndex) % 60],
        kyuusei_kanji: '火',
        kyuusei_num: ((dayIndex % 9) + 1)
      }));
      offset += daysInMonth;
      return {
        month,
        month_kanshi: '丁丑',
        kyoku: '陰9局',
        kyuusei: '6白',
        sekki: month === 1 || month === 4 || month === 7 || month === 10
          ? [
              { name: '小寒', date: `${month}/5`, time: '16:31', type: 'sekki' as const },
              { name: '土旺', date: `${month}/17`, time: '11:10', type: 'doou' as const },
              { name: '大寒', date: `${month}/20`, time: '09:54', type: 'sekki' as const }
            ]
          : [
              { name: '立春', date: `${month}/5`, time: '16:31', type: 'sekki' as const },
              { name: '雨水', date: `${month}/20`, time: '09:54', type: 'sekki' as const }
            ],
        days
      };
    })
  };
}

describe('validateKoyomi', () => {
  it('accepts valid data', () => {
    expect(validateKoyomi(createValidKoyomi())).toHaveLength(0);
  });

  it('detects broken continuity', () => {
    const koyomi = createValidKoyomi();
    koyomi.months[0].days[1].kanshi = '丙寅';
    expect(validateKoyomi(koyomi).some((error) => error.category === 'kanshi_continuity')).toBe(true);
  });

  it('detects missing sekki', () => {
    const koyomi = createValidKoyomi();
    koyomi.months[0].sekki = koyomi.months[0].sekki.slice(0, 2);
    expect(validateKoyomi(koyomi).some((error) => error.category === 'sekki_count')).toBe(true);
  });
});
