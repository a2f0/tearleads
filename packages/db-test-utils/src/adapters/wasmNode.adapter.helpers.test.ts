import { describe, expect, it } from 'vitest';
import { __test__ } from './wasmNode.adapter.js';

const {
  getStringField,
  isJsonBackupData,
  isNameSqlEntry,
  keyToHex,
  parseJsonBackupData
} = __test__;

describe('helper functions', () => {
  describe('getStringField', () => {
    it('returns string value', () => {
      expect(getStringField({ foo: 'bar' }, 'foo')).toBe('bar');
    });

    it('returns null for non-string value', () => {
      expect(getStringField({ foo: 123 }, 'foo')).toBeNull();
    });

    it('returns null for missing key', () => {
      expect(getStringField({}, 'foo')).toBeNull();
    });
  });

  describe('isNameSqlEntry', () => {
    it('returns true for valid entry', () => {
      expect(isNameSqlEntry({ name: 'test', sql: 'CREATE TABLE' })).toBe(true);
    });

    it('returns false for invalid entry', () => {
      expect(isNameSqlEntry({ name: 123, sql: 'CREATE TABLE' })).toBe(false);
      expect(isNameSqlEntry({ name: 'test' })).toBe(false);
      expect(isNameSqlEntry(null)).toBe(false);
    });
  });

  describe('isJsonBackupData', () => {
    it('returns true for valid backup data', () => {
      expect(
        isJsonBackupData({
          version: 1,
          tables: [{ name: 'test', sql: 'CREATE TABLE' }],
          indexes: [],
          data: { test: [{ id: 1 }] }
        })
      ).toBe(true);
    });

    it('returns false for invalid data', () => {
      expect(isJsonBackupData(null)).toBe(false);
      expect(isJsonBackupData({ version: 'string' })).toBe(false);
      expect(isJsonBackupData({ version: 1, tables: 'not-array' })).toBe(false);
      expect(
        isJsonBackupData({ version: 1, tables: [{ invalid: true }] })
      ).toBe(false);
      expect(isJsonBackupData({ version: 1, tables: [], indexes: [] })).toBe(
        false
      );
      expect(
        isJsonBackupData({
          version: 1,
          tables: [],
          indexes: [],
          data: 'not-object'
        })
      ).toBe(false);
      expect(
        isJsonBackupData({
          version: 1,
          tables: [],
          indexes: [],
          data: { test: 'not-array' }
        })
      ).toBe(false);
      expect(
        isJsonBackupData({
          version: 1,
          tables: [],
          indexes: [],
          data: { test: ['not-record'] }
        })
      ).toBe(false);
    });
  });

  describe('parseJsonBackupData', () => {
    it('parses valid JSON', () => {
      const data = parseJsonBackupData(
        JSON.stringify({
          version: 1,
          tables: [],
          indexes: [],
          data: {}
        })
      );
      expect(data.version).toBe(1);
    });

    it('throws on invalid JSON', () => {
      expect(() => parseJsonBackupData('not json')).toThrow();
    });

    it('throws on invalid backup format', () => {
      expect(() => parseJsonBackupData('{}')).toThrow(
        'Invalid backup data format'
      );
    });
  });

  describe('keyToHex', () => {
    it('converts key to hex string', () => {
      const key = new Uint8Array([0x00, 0x0f, 0x10, 0xff]);
      expect(keyToHex(key)).toBe('000f10ff');
    });
  });
});
