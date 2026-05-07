import { describe, expect, it } from 'vitest';
import { getExpectedSekkiCount, isDoouMonth, parseSekkiString } from '../../src/domain/sekki.js';

describe('sekki', () => {
  it('detects doou months', () => {
    expect(isDoouMonth(1)).toBe(true);
    expect(isDoouMonth(2)).toBe(false);
  });

  it('returns expected counts', () => {
    expect(getExpectedSekkiCount(1)).toBe(3);
    expect(getExpectedSekkiCount(2)).toBe(2);
  });

  it('parses strings', () => {
    expect(parseSekkiString('土旺 1/17 11:10')).toEqual({
      name: '土旺',
      date: '1/17',
      time: '11:10',
      type: 'doou'
    });
  });
});
