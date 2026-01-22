import { describe, expect, it } from 'vitest';
import {
  buildCreateAccountInput,
  normalizeEmail,
  normalizePassword
} from './create-account.js';

describe('normalizeEmail', () => {
  it('trims and lowercases emails', () => {
    expect(normalizeEmail('  Test@Example.com ')).toBe('test@example.com');
  });

  it('throws for empty emails', () => {
    expect(() => normalizeEmail('   ')).toThrowError('Email is required.');
  });
});

describe('normalizePassword', () => {
  it('trims passwords', () => {
    expect(normalizePassword('  secret  ')).toBe('secret');
  });

  it('throws for empty passwords', () => {
    expect(() => normalizePassword('   ')).toThrowError(
      'Password is required.'
    );
  });
});

describe('buildCreateAccountInput', () => {
  it('normalizes email and password together', () => {
    expect(buildCreateAccountInput(' User@Example.com ', ' pass ')).toEqual({
      email: 'user@example.com',
      password: 'pass'
    });
  });
});
