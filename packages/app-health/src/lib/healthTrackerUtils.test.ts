import { describe, expect, it } from 'vitest';
import {
  createSlug,
  fromCentiHeight,
  normalizeHeightUnit,
  toCentiHeight
} from './healthTrackerUtils.js';

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

describe('height utilities', () => {
  it('normalizes height units with an imperial default', () => {
    expect(normalizeHeightUnit(undefined, 'unit')).toBe('in');
    expect(normalizeHeightUnit('cm', 'unit')).toBe('cm');
  });

  it('converts height values to and from centi-units', () => {
    expect(toCentiHeight(42.25, 'value')).toBe(4225);
    expect(fromCentiHeight(4225)).toBe(42.25);
  });
});
