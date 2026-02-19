import { describe, expect, it } from 'vitest';
import { cn } from './utils';

describe('cn', () => {
  it('joins string and numeric class values', () => {
    expect(cn('alpha', 2, '', null, undefined, false)).toBe('alpha 2');
  });

  it('handles nested arrays and object maps', () => {
    expect(
      cn('base', ['nested', [0, 'deep']], { active: true, disabled: false })
    ).toBe('base nested deep active');
  });

  it('returns empty string for falsy/disabled inputs', () => {
    expect(cn('', null, undefined, false, [], { off: false })).toBe('');
  });
});
