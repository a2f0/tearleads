import { describe, expect, it } from 'vitest';
import { isVfsAlreadyRegisteredError } from './vfsRegistrationErrors';

describe('vfsRegistrationErrors', () => {
  it('returns true when message indicates item is already registered', () => {
    expect(
      isVfsAlreadyRegisteredError(new Error('Item already registered in VFS'))
    ).toBe(true);
    expect(
      isVfsAlreadyRegisteredError(new Error('API already exists'))
    ).toBe(true);
  });

  it('returns true when status is conflict', () => {
    const numericStatusError = new Error('API error: 409');
    Reflect.set(numericStatusError, 'status', 409);

    const stringStatusError = new Error('Conflict');
    Reflect.set(stringStatusError, 'status', '409');

    expect(isVfsAlreadyRegisteredError(numericStatusError)).toBe(true);
    expect(isVfsAlreadyRegisteredError(stringStatusError)).toBe(true);
  });

  it('returns false for other errors', () => {
    const error = new Error('Network error');
    Reflect.set(error, 'status', 500);

    expect(isVfsAlreadyRegisteredError(error)).toBe(false);
    expect(isVfsAlreadyRegisteredError(null)).toBe(false);
  });
});
