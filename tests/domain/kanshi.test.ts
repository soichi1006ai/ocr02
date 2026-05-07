import { describe, expect, it } from 'vitest';
import { getDaysInMonth, getKanshiIndex, isKanshiContinuous, KANSHI_60 } from '../../src/domain/kanshi.js';

describe('kanshi', () => {
  it('contains 60 entries', () => {
    expect(KANSHI_60).toHaveLength(60);
  });

  it('returns indices', () => {
    expect(getKanshiIndex('甲子')).toBe(0);
    expect(getKanshiIndex('癸亥')).toBe(59);
  });

  it('checks continuity', () => {
    expect(isKanshiContinuous(['甲子', '乙丑', '丙寅'])).toBe(true);
    expect(isKanshiContinuous(['癸亥', '甲子'])).toBe(true);
    expect(isKanshiContinuous(['甲子', '丙寅'])).toBe(false);
  });

  it('supports leap years', () => {
    expect(getDaysInMonth(2024, 2)).toBe(29);
    expect(getDaysInMonth(2025, 2)).toBe(28);
  });
});
