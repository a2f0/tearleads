/**
 * Unit tests for custom error types.
 */

import { describe, expect, it } from 'vitest';
import { UnsupportedFileTypeError } from './errors';

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
