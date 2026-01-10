import { describe, expect, it } from 'vitest';
import {
  formatDefaultValue,
  getPostgresTypeInfo,
  getSqliteTypeInfo,
  POSTGRES_TYPE_MAP,
  SQLITE_TYPE_MAP
} from './type-mapping.js';

describe('SQLITE_TYPE_MAP', () => {
  it('has correct mappings for all column types', () => {
    expect(SQLITE_TYPE_MAP.text).toEqual({ drizzleType: 'text' });
    expect(SQLITE_TYPE_MAP.integer).toEqual({ drizzleType: 'integer' });
    expect(SQLITE_TYPE_MAP.boolean).toEqual({
      drizzleType: 'integer',
      mode: 'boolean'
    });
    expect(SQLITE_TYPE_MAP.timestamp).toEqual({
      drizzleType: 'integer',
      mode: 'timestamp_ms'
    });
    expect(SQLITE_TYPE_MAP.json).toEqual({ drizzleType: 'text' });
  });
});

describe('POSTGRES_TYPE_MAP', () => {
  it('has correct mappings for all column types', () => {
    expect(POSTGRES_TYPE_MAP.text).toEqual({ drizzleType: 'text' });
    expect(POSTGRES_TYPE_MAP.integer).toEqual({ drizzleType: 'integer' });
    expect(POSTGRES_TYPE_MAP.boolean).toEqual({ drizzleType: 'boolean' });
    expect(POSTGRES_TYPE_MAP.timestamp).toEqual({
      drizzleType: 'timestamp',
      withTimezone: true
    });
    expect(POSTGRES_TYPE_MAP.json).toEqual({ drizzleType: 'jsonb' });
  });
});

describe('getSqliteTypeInfo', () => {
  it('returns correct type info for each column type', () => {
    expect(getSqliteTypeInfo('text')).toEqual({ drizzleType: 'text' });
    expect(getSqliteTypeInfo('integer')).toEqual({ drizzleType: 'integer' });
    expect(getSqliteTypeInfo('boolean')).toEqual({
      drizzleType: 'integer',
      mode: 'boolean'
    });
    expect(getSqliteTypeInfo('timestamp')).toEqual({
      drizzleType: 'integer',
      mode: 'timestamp_ms'
    });
    expect(getSqliteTypeInfo('json')).toEqual({ drizzleType: 'text' });
  });
});

describe('getPostgresTypeInfo', () => {
  it('returns correct type info for each column type', () => {
    expect(getPostgresTypeInfo('text')).toEqual({ drizzleType: 'text' });
    expect(getPostgresTypeInfo('integer')).toEqual({ drizzleType: 'integer' });
    expect(getPostgresTypeInfo('boolean')).toEqual({ drizzleType: 'boolean' });
    expect(getPostgresTypeInfo('timestamp')).toEqual({
      drizzleType: 'timestamp',
      withTimezone: true
    });
    expect(getPostgresTypeInfo('json')).toEqual({ drizzleType: 'jsonb' });
  });
});

describe('formatDefaultValue', () => {
  it('formats string values with quotes', () => {
    expect(formatDefaultValue('hello', 'text')).toBe("'hello'");
    expect(formatDefaultValue('pending', 'text')).toBe("'pending'");
  });

  it('formats number values as-is', () => {
    expect(formatDefaultValue(0, 'integer')).toBe('0');
    expect(formatDefaultValue(42, 'integer')).toBe('42');
    expect(formatDefaultValue(-1, 'integer')).toBe('-1');
  });

  it('formats boolean values as-is', () => {
    expect(formatDefaultValue(true, 'boolean')).toBe('true');
    expect(formatDefaultValue(false, 'boolean')).toBe('false');
  });
});
