import { describe, expect, it } from 'vitest';
import {
  isColumnDefinition,
  isColumnType,
  isIndexDefinition,
  isTableDefinition
} from './types.js';

describe('isColumnType', () => {
  it('returns true for valid column types', () => {
    expect(isColumnType('text')).toBe(true);
    expect(isColumnType('integer')).toBe(true);
    expect(isColumnType('boolean')).toBe(true);
    expect(isColumnType('timestamp')).toBe(true);
    expect(isColumnType('json')).toBe(true);
  });

  it('returns false for invalid column types', () => {
    expect(isColumnType('string')).toBe(false);
    expect(isColumnType('number')).toBe(false);
    expect(isColumnType('')).toBe(false);
    expect(isColumnType(null)).toBe(false);
    expect(isColumnType(undefined)).toBe(false);
    expect(isColumnType(123)).toBe(false);
    expect(isColumnType({})).toBe(false);
  });
});

describe('isColumnDefinition', () => {
  it('returns true for valid column definitions', () => {
    expect(
      isColumnDefinition({
        type: 'text',
        sqlName: 'my_column'
      })
    ).toBe(true);

    expect(
      isColumnDefinition({
        type: 'integer',
        sqlName: 'id',
        primaryKey: true
      })
    ).toBe(true);

    expect(
      isColumnDefinition({
        type: 'boolean',
        sqlName: 'is_active',
        notNull: true,
        defaultValue: false
      })
    ).toBe(true);

    expect(
      isColumnDefinition({
        type: 'text',
        sqlName: 'status',
        enumValues: ['pending', 'active']
      })
    ).toBe(true);
  });

  it('returns false for null or non-object', () => {
    expect(isColumnDefinition(null)).toBe(false);
    expect(isColumnDefinition(undefined)).toBe(false);
    expect(isColumnDefinition('string')).toBe(false);
    expect(isColumnDefinition(123)).toBe(false);
  });

  it('returns false for invalid type', () => {
    expect(
      isColumnDefinition({
        type: 'invalid',
        sqlName: 'my_column'
      })
    ).toBe(false);
  });

  it('returns false for missing sqlName', () => {
    expect(
      isColumnDefinition({
        type: 'text'
      })
    ).toBe(false);
  });

  it('returns false for empty sqlName', () => {
    expect(
      isColumnDefinition({
        type: 'text',
        sqlName: ''
      })
    ).toBe(false);
  });

  it('returns false for non-string sqlName', () => {
    expect(
      isColumnDefinition({
        type: 'text',
        sqlName: 123
      })
    ).toBe(false);
  });
});

describe('isIndexDefinition', () => {
  it('returns true for valid index definitions', () => {
    expect(
      isIndexDefinition({
        name: 'my_index',
        columns: ['column1']
      })
    ).toBe(true);

    expect(
      isIndexDefinition({
        name: 'composite_idx',
        columns: ['col1', 'col2', 'col3']
      })
    ).toBe(true);

    expect(
      isIndexDefinition({
        name: 'unique_idx',
        columns: ['email'],
        unique: true
      })
    ).toBe(true);
  });

  it('returns false for null or non-object', () => {
    expect(isIndexDefinition(null)).toBe(false);
    expect(isIndexDefinition(undefined)).toBe(false);
    expect(isIndexDefinition('string')).toBe(false);
    expect(isIndexDefinition(123)).toBe(false);
  });

  it('returns false for missing name', () => {
    expect(
      isIndexDefinition({
        columns: ['col1']
      })
    ).toBe(false);
  });

  it('returns false for empty name', () => {
    expect(
      isIndexDefinition({
        name: '',
        columns: ['col1']
      })
    ).toBe(false);
  });

  it('returns false for non-string name', () => {
    expect(
      isIndexDefinition({
        name: 123,
        columns: ['col1']
      })
    ).toBe(false);
  });

  it('returns false for missing columns', () => {
    expect(
      isIndexDefinition({
        name: 'my_index'
      })
    ).toBe(false);
  });

  it('returns false for empty columns array', () => {
    expect(
      isIndexDefinition({
        name: 'my_index',
        columns: []
      })
    ).toBe(false);
  });

  it('returns false for non-array columns', () => {
    expect(
      isIndexDefinition({
        name: 'my_index',
        columns: 'col1'
      })
    ).toBe(false);
  });

  it('returns false for non-string column values', () => {
    expect(
      isIndexDefinition({
        name: 'my_index',
        columns: [123, 'col2']
      })
    ).toBe(false);
  });
});

describe('isTableDefinition', () => {
  it('returns true for valid table definitions', () => {
    expect(
      isTableDefinition({
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'text', sqlName: 'id', primaryKey: true }
        }
      })
    ).toBe(true);

    expect(
      isTableDefinition({
        name: 'user_settings',
        propertyName: 'userSettings',
        columns: {
          key: { type: 'text', sqlName: 'key', primaryKey: true },
          value: { type: 'text', sqlName: 'value' }
        },
        indexes: [{ name: 'key_idx', columns: ['key'] }],
        comment: 'User settings table'
      })
    ).toBe(true);
  });

  it('returns false for null or non-object', () => {
    expect(isTableDefinition(null)).toBe(false);
    expect(isTableDefinition(undefined)).toBe(false);
    expect(isTableDefinition('string')).toBe(false);
    expect(isTableDefinition(123)).toBe(false);
  });

  it('returns false for missing name', () => {
    expect(
      isTableDefinition({
        propertyName: 'users',
        columns: {}
      })
    ).toBe(false);
  });

  it('returns false for empty name', () => {
    expect(
      isTableDefinition({
        name: '',
        propertyName: 'users',
        columns: {}
      })
    ).toBe(false);
  });

  it('returns false for non-string name', () => {
    expect(
      isTableDefinition({
        name: 123,
        propertyName: 'users',
        columns: {}
      })
    ).toBe(false);
  });

  it('returns false for missing propertyName', () => {
    expect(
      isTableDefinition({
        name: 'users',
        columns: {}
      })
    ).toBe(false);
  });

  it('returns false for empty propertyName', () => {
    expect(
      isTableDefinition({
        name: 'users',
        propertyName: '',
        columns: {}
      })
    ).toBe(false);
  });

  it('returns false for non-string propertyName', () => {
    expect(
      isTableDefinition({
        name: 'users',
        propertyName: 123,
        columns: {}
      })
    ).toBe(false);
  });

  it('returns false for missing columns', () => {
    expect(
      isTableDefinition({
        name: 'users',
        propertyName: 'users'
      })
    ).toBe(false);
  });

  it('returns false for null columns', () => {
    expect(
      isTableDefinition({
        name: 'users',
        propertyName: 'users',
        columns: null
      })
    ).toBe(false);
  });

  it('returns false for invalid column definition', () => {
    expect(
      isTableDefinition({
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'invalid', sqlName: 'id' }
        }
      })
    ).toBe(false);
  });

  it('returns false for non-array indexes', () => {
    expect(
      isTableDefinition({
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'text', sqlName: 'id' }
        },
        indexes: 'not an array'
      })
    ).toBe(false);
  });

  it('returns false for invalid index definition', () => {
    expect(
      isTableDefinition({
        name: 'users',
        propertyName: 'users',
        columns: {
          id: { type: 'text', sqlName: 'id' }
        },
        indexes: [{ name: '', columns: [] }]
      })
    ).toBe(false);
  });
});
