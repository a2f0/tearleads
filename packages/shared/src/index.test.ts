import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPENROUTER_MODEL_ID,
  formatDate,
  getErrorCode,
  getOpenRouterModelOption,
  isOpenRouterModelId,
  isRecord,
  OPENROUTER_CHAT_MODELS,
  toFiniteNumber,
  validateChatMessages
} from './index.js';

describe('formatDate', () => {
  it('should return an ISO string for a valid date', () => {
    const date = new Date('2024-01-15T10:30:00.000Z');
    const result = formatDate(date);
    expect(result).toBe('2024-01-15T10:30:00.000Z');
  });

  it('should handle different valid dates', () => {
    const date = new Date('1999-12-31T23:59:59.999Z');
    const result = formatDate(date);
    expect(result).toBe('1999-12-31T23:59:59.999Z');
  });

  it('should throw for an invalid date', () => {
    const invalidDate = new Date('not a date');
    expect(() => formatDate(invalidDate)).toThrow(RangeError);
  });
});

describe('isRecord', () => {
  it('should return true for plain objects', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ key: 'value' })).toBe(true);
  });

  it('should return true for arrays (they are objects)', () => {
    expect(isRecord([])).toBe(true);
    expect(isRecord([1, 2, 3])).toBe(true);
  });

  it('should return false for null', () => {
    expect(isRecord(null)).toBe(false);
  });

  it('should return false for primitives', () => {
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord('string')).toBe(false);
    expect(isRecord(123)).toBe(false);
    expect(isRecord(true)).toBe(false);
    expect(isRecord(Symbol('sym'))).toBe(false);
  });
});

describe('getErrorCode', () => {
  it('should return string code from error-like objects', () => {
    expect(getErrorCode({ code: 'ENOENT' })).toBe('ENOENT');
    expect(getErrorCode({ code: 'SQLITE_BUSY' })).toBe('SQLITE_BUSY');
  });

  it('should return undefined for non-string codes', () => {
    expect(getErrorCode({ code: 123 })).toBeUndefined();
    expect(getErrorCode({ code: null })).toBeUndefined();
    expect(getErrorCode({ code: undefined })).toBeUndefined();
  });

  it('should return undefined for non-objects', () => {
    expect(getErrorCode(null)).toBeUndefined();
    expect(getErrorCode(undefined)).toBeUndefined();
    expect(getErrorCode('error string')).toBeUndefined();
    expect(getErrorCode(123)).toBeUndefined();
  });

  it('should return undefined for objects without code property', () => {
    expect(getErrorCode({})).toBeUndefined();
    expect(getErrorCode({ message: 'error' })).toBeUndefined();
  });
});

describe('toFiniteNumber', () => {
  it('should return the number for finite values', () => {
    expect(toFiniteNumber(42)).toBe(42);
    expect(toFiniteNumber(0)).toBe(0);
    expect(toFiniteNumber(-3.14)).toBe(-3.14);
  });

  it('should return null for non-finite numbers', () => {
    expect(toFiniteNumber(Infinity)).toBeNull();
    expect(toFiniteNumber(-Infinity)).toBeNull();
    expect(toFiniteNumber(NaN)).toBeNull();
  });

  it('should parse numeric strings', () => {
    expect(toFiniteNumber('42')).toBe(42);
    expect(toFiniteNumber('3.14')).toBe(3.14);
    expect(toFiniteNumber('-100')).toBe(-100);
    expect(toFiniteNumber('  42  ')).toBe(42);
  });

  it('should return null for non-numeric strings', () => {
    expect(toFiniteNumber('')).toBeNull();
    expect(toFiniteNumber('   ')).toBeNull();
    expect(toFiniteNumber('abc')).toBeNull();
    expect(toFiniteNumber('42abc')).toBeNull();
  });

  it('should return null for non-number/string types', () => {
    expect(toFiniteNumber(null)).toBeNull();
    expect(toFiniteNumber(undefined)).toBeNull();
    expect(toFiniteNumber({})).toBeNull();
    expect(toFiniteNumber([])).toBeNull();
  });
});

describe('validateChatMessages', () => {
  it('accepts text-only messages', () => {
    const result = validateChatMessages([{ role: 'user', content: 'Hello' }]);

    if (!result.ok) {
      throw new Error(`Expected ok result, got: ${result.error}`);
    }

    expect(result.messages).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('accepts multimodal messages', () => {
    const result = validateChatMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this.' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } }
        ]
      }
    ]);

    if (!result.ok) {
      throw new Error(`Expected ok result, got: ${result.error}`);
    }

    expect(result.messages[0]?.role).toBe('user');
  });

  it('rejects empty message arrays', () => {
    const result = validateChatMessages([]);

    if (result.ok) {
      throw new Error('Expected error result');
    }

    expect(result.error).toBe('messages must be a non-empty array');
  });

  it('rejects invalid roles', () => {
    const result = validateChatMessages([
      { role: 'unknown', content: 'Hello' }
    ]);

    if (result.ok) {
      throw new Error('Expected error result');
    }

    expect(result.error).toBe(
      'messages[0].role must be one of: system, user, assistant, tool'
    );
  });

  it('rejects invalid image content', () => {
    const result = validateChatMessages([
      {
        role: 'user',
        content: [{ type: 'image_url', image_url: { url: '' } }]
      }
    ]);

    if (result.ok) {
      throw new Error('Expected error result');
    }

    expect(result.error).toBe(
      'messages[0].content[0].image_url.url must be a non-empty string'
    );
  });
});

describe('OpenRouter models', () => {
  it('includes the default model in the list', () => {
    const ids = OPENROUTER_CHAT_MODELS.map((model) => model.id);
    expect(ids).toContain(DEFAULT_OPENROUTER_MODEL_ID);
  });

  it('returns model details for supported IDs', () => {
    const model = getOpenRouterModelOption(DEFAULT_OPENROUTER_MODEL_ID);
    expect(model?.id).toBe(DEFAULT_OPENROUTER_MODEL_ID);
  });

  it('returns null for unknown model IDs', () => {
    expect(getOpenRouterModelOption('unknown/model')).toBeNull();
  });

  it('identifies supported model IDs', () => {
    expect(isOpenRouterModelId(DEFAULT_OPENROUTER_MODEL_ID)).toBe(true);
    expect(isOpenRouterModelId('unknown/model')).toBe(false);
  });
});
