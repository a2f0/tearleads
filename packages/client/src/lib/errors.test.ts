/**
 * Unit tests for custom error types.
 */

import { describe, expect, it } from 'vitest';
import {
  getErrorMessage,
  isError,
  toError,
  UnsupportedFileTypeError
} from './errors';

describe('isError', () => {
  it('returns true for Error instances', () => {
    expect(isError(new Error('test'))).toBe(true);
  });

  it('returns true for Error subclasses', () => {
    expect(isError(new TypeError('type error'))).toBe(true);
    expect(isError(new RangeError('range error'))).toBe(true);
    expect(isError(new UnsupportedFileTypeError('file.bin'))).toBe(true);
  });

  it('returns false for non-Error values', () => {
    expect(isError('error string')).toBe(false);
    expect(isError(123)).toBe(false);
    expect(isError(null)).toBe(false);
    expect(isError(undefined)).toBe(false);
    expect(isError({ message: 'fake error' })).toBe(false);
  });
});

describe('getErrorMessage', () => {
  it('returns message from Error instances', () => {
    expect(getErrorMessage(new Error('test message'))).toBe('test message');
  });

  it('returns message from error-like objects', () => {
    expect(getErrorMessage({ message: 'object message' })).toBe(
      'object message'
    );
  });

  it('converts non-string message properties to string', () => {
    expect(getErrorMessage({ message: 123 })).toBe('123');
    expect(getErrorMessage({ message: true })).toBe('true');
  });

  it('converts primitive values to string', () => {
    expect(getErrorMessage('string error')).toBe('string error');
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});

describe('toError', () => {
  it('returns Error instances unchanged', () => {
    const error = new Error('original');
    expect(toError(error)).toBe(error);
  });

  it('returns Error subclass instances unchanged', () => {
    const error = new TypeError('type error');
    expect(toError(error)).toBe(error);
  });

  it('wraps non-Error values in a new Error', () => {
    const result = toError('string error');
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('string error');
  });

  it('wraps error-like objects in a new Error', () => {
    const result = toError({ message: 'object error' });
    expect(result).toBeInstanceOf(Error);
    expect(result.message).toBe('object error');
  });

  it('wraps primitive values in a new Error', () => {
    const numResult = toError(404);
    expect(numResult).toBeInstanceOf(Error);
    expect(numResult.message).toBe('404');

    const nullResult = toError(null);
    expect(nullResult).toBeInstanceOf(Error);
    expect(nullResult.message).toBe('null');
  });
});

describe('UnsupportedFileTypeError', () => {
  it('extends Error', () => {
    const error = new UnsupportedFileTypeError('test.bin');
    expect(error).toBeInstanceOf(Error);
  });

  it('has correct name property', () => {
    const error = new UnsupportedFileTypeError('test.bin');
    expect(error.name).toBe('UnsupportedFileTypeError');
  });

  it('includes filename in message', () => {
    const error = new UnsupportedFileTypeError('test.bin');
    expect(error.message).toContain('test.bin');
  });

  it('has descriptive error message', () => {
    const error = new UnsupportedFileTypeError('document.xyz');
    expect(error.message).toBe(
      'Unable to detect file type for "document.xyz". Only files with recognizable formats are supported.'
    );
  });

  it('can be thrown and caught', () => {
    expect(() => {
      throw new UnsupportedFileTypeError('unknown.file');
    }).toThrow(UnsupportedFileTypeError);
  });

  it('can be caught as a generic Error', () => {
    expect(() => {
      throw new UnsupportedFileTypeError('unknown.file');
    }).toThrow(Error);
  });

  it('preserves stack trace', () => {
    const error = new UnsupportedFileTypeError('test.bin');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('UnsupportedFileTypeError');
  });
});
