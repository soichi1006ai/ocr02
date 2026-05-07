import { describe, expect, it } from 'vitest';
import { splitKyuusei } from '../../src/domain/kyuusei.js';

describe('kyuusei', () => {
  it('splits valid values', () => {
    expect(splitKyuusei('火6')).toEqual({ kanji: '火', num: 6 });
  });

  it('rejects invalid values', () => {
    expect(() => splitKyuusei('火A')).toThrow();
    expect(() => splitKyuusei('hoge')).toThrow();
  });
});
