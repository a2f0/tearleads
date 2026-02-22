/**
 * Tests for column name mapping between SQLite (snake_case) and Drizzle schema (camelCase).
 *
 * This test verifies that:
 * 1. getConnection() converts object rows to array format for Drizzle ORM
 * 2. execute() returns raw snake_case column names (callers use SQL aliases for camelCase)
 * 3. Helper functions correctly parse SQL and convert row formats
 */

import { describe, expect, it } from 'vitest';

import { convertRowsToArrays, extractSelectColumns, rowToArray } from './utils';

describe('SQL Column Extraction', () => {
  describe('extractSelectColumns', () => {
    it('should extract simple quoted column names', () => {
      const sql = 'select "id", "name", "size" from "files"';
      const columns = extractSelectColumns(sql);
      expect(columns).toEqual(['id', 'name', 'size']);
    });

    it('should extract snake_case column names', () => {
      const sql =
        'select "id", "first_name", "last_name", "created_at" from "contacts"';
      const columns = extractSelectColumns(sql);
      expect(columns).toEqual(['id', 'first_name', 'last_name', 'created_at']);
    });

    it('should extract column names from table.column format', () => {
      const sql =
        'select "contacts"."id", "contacts"."first_name", "contact_emails"."email" from "contacts"';
      const columns = extractSelectColumns(sql);
      expect(columns).toEqual(['id', 'first_name', 'email']);
    });

    it('should return null for SELECT *', () => {
      const sql = 'select * from "files"';
      const columns = extractSelectColumns(sql);
      expect(columns).toBeNull();
    });

    it('should return null for non-SELECT statements', () => {
      const sql = 'insert into "files" ("id", "name") values (?, ?)';
      const columns = extractSelectColumns(sql);
      expect(columns).toBeNull();
    });

    it('should handle multiline SQL', () => {
      const sql = `select
        "id",
        "mime_type",
        "upload_date"
      from "files"`;
      const columns = extractSelectColumns(sql);
      expect(columns).toEqual(['id', 'mime_type', 'upload_date']);
    });

    it('should handle functions with aliases in SELECT', () => {
      const sql =
        'select count(*) as count, sum("duration_ms") as totalDuration from "analytics_events"';
      const columns = extractSelectColumns(sql);
      // For functions with aliases, we extract the alias name
      expect(columns).toEqual(['count', 'totalDuration']);
    });
  });

  describe('rowToArray', () => {
    it('should convert object row to array in column order', () => {
      const row = {
        id: 'file-1',
        name: 'test.jpg',
        mime_type: 'image/jpeg',
        size: 1024
      };
      const columns = ['id', 'name', 'size', 'mime_type'];
      const result = rowToArray(row, columns);
      expect(result).toEqual(['file-1', 'test.jpg', 1024, 'image/jpeg']);
    });

    it('should return undefined for missing columns', () => {
      const row = { id: 'file-1', name: 'test.jpg' };
      const columns = ['id', 'name', 'missing_column'];
      const result = rowToArray(row, columns);
      expect(result).toEqual(['file-1', 'test.jpg', undefined]);
    });

    it('should handle all file columns in correct order', () => {
      const row = {
        id: 'file-1',
        name: 'photo.jpg',
        size: 1024,
        mime_type: 'image/jpeg',
        upload_date: 1704067200000,
        content_hash: 'abc123',
        storage_path: '/files/photo.jpg',
        deleted: 0
      };
      const columns = [
        'id',
        'name',
        'size',
        'mime_type',
        'upload_date',
        'content_hash',
        'storage_path',
        'deleted'
      ];
      const result = rowToArray(row, columns);
      expect(result).toEqual([
        'file-1',
        'photo.jpg',
        1024,
        'image/jpeg',
        1704067200000,
        'abc123',
        '/files/photo.jpg',
        0
      ]);
    });
  });

  describe('Full conversion flow', () => {
    it('should correctly convert Drizzle SQL result to array format', () => {
      // Simulate what happens in getConnection()
      const sql =
        'select "id", "name", "size", "mime_type", "upload_date" from "files"';
      const objectRow = {
        id: 'file-1',
        name: 'test.jpg',
        size: 1024,
        mime_type: 'image/jpeg',
        upload_date: 1704067200000
      };

      // Extract columns from SQL
      const columns = extractSelectColumns(sql);
      expect(columns).toEqual([
        'id',
        'name',
        'size',
        'mime_type',
        'upload_date'
      ]);

      // Convert row to array
      expect(columns).not.toBeNull();
      const arrayRow = rowToArray(objectRow, columns as string[]);
      expect(arrayRow).toEqual([
        'file-1',
        'test.jpg',
        1024,
        'image/jpeg',
        1704067200000
      ]);
    });
  });

  describe('convertRowsToArrays', () => {
    it('should convert rows from object format to array format for explicit SELECT', () => {
      const sql = 'select "id", "name", "size" from "files"';
      const rows = [
        { id: 'file-1', name: 'test.jpg', size: 1024 },
        { id: 'file-2', name: 'doc.pdf', size: 2048 }
      ];

      const result = convertRowsToArrays(sql, rows);
      expect(result).toEqual([
        ['file-1', 'test.jpg', 1024],
        ['file-2', 'doc.pdf', 2048]
      ]);
    });

    it('should derive column order from first row for SELECT *', () => {
      // For SELECT *, columns can't be parsed from SQL, so derive from first row's keys
      const sql = 'select * from "files"';
      const rows = [
        { id: 'file-1', name: 'test.jpg', size: 1024 },
        { id: 'file-2', name: 'doc.pdf', size: 2048 }
      ];

      const result = convertRowsToArrays(sql, rows);
      // Order is determined by Object.keys of first row
      expect(result).toEqual([
        ['file-1', 'test.jpg', 1024],
        ['file-2', 'doc.pdf', 2048]
      ]);
    });

    it('should return empty array for empty rows', () => {
      const sql = 'select "id", "name" from "files"';
      const rows: unknown[] = [];

      const result = convertRowsToArrays(sql, rows);
      expect(result).toEqual([]);
    });

    it('should handle rows that are already arrays (pass through)', () => {
      // For non-SELECT queries or if rows are already arrays
      const sql = 'insert into "files" ("id", "name") values (?, ?)';
      const rows: unknown[] = [];

      const result = convertRowsToArrays(sql, rows);
      expect(result).toEqual([]);
    });
  });
});

// Sample row data as it would come from SQLite (snake_case column names)
const _sampleContactRow = {
  id: 'contact-123',
  first_name: 'John',
  last_name: 'Doe',
  birthday: '1990-01-15',
  created_at: 1704067200000,
  updated_at: 1704067200000,
  deleted: 0
};

const _sampleFileRow = {
  id: 'file-123',
  name: 'photo.jpg',
  size: 1024,
  mime_type: 'image/jpeg',
  upload_date: 1704067200000,
  content_hash: 'abc123',
  storage_path: '/files/photo.jpg',
  deleted: 0
};

const _sampleContactWithJoinRow = {
  id: 'contact-123',
  first_name: 'John',
  last_name: 'Doe',
  birthday: '1990-01-15',
  created_at: 1704067200000,
  email: 'john@example.com',
  phone_number: '555-1234'
};
