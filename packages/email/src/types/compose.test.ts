import { describe, expect, it } from 'vitest';
import { isValidEmail, validateEmailAddresses } from './compose';

describe('compose email validation', () => {
  it('accepts basic valid addresses', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user.name+tag@example.co.uk')).toBe(true);
  });

  it('rejects malformed addresses', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('user')).toBe(false);
    expect(isValidEmail('user@@example.com')).toBe(false);
    expect(isValidEmail('user@example')).toBe(false);
    expect(isValidEmail('user@.example.com')).toBe(false);
    expect(isValidEmail('user@example..com')).toBe(false);
    expect(isValidEmail('user @example.com')).toBe(false);
  });

  it('reports invalid addresses in comma-separated input', () => {
    expect(validateEmailAddresses('a@example.com, bad, b@example.com')).toEqual(
      {
        valid: false,
        invalidEmails: ['bad']
      }
    );
  });
});
