import { describe, expect, it } from 'vitest';
import { createSlug } from './healthTrackerUtils.js';

describe('createSlug', () => {
  it('normalizes whitespace and punctuation into single dashes', () => {
    expect(createSlug(' Front Squat / Pause ')).toBe('front-squat-pause');
  });

  it('trims leading and trailing separators', () => {
    expect(createSlug('---Bench Press---')).toBe('bench-press');
  });

  it('returns empty string when no alphanumeric characters exist', () => {
    expect(createSlug('!!!')).toBe('');
  });
});
