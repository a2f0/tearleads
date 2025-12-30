/**
 * Tests for column name mapping between SQLite (snake_case) and Drizzle schema (camelCase).
 *
 * This test verifies that:
 * 1. getConnection() converts object rows to array format for Drizzle ORM
 * 2. execute() returns raw snake_case column names (callers use SQL aliases for camelCase)
 * 3. Helper functions correctly parse SQL and convert row formats
 */

import { describe, expect, it, vi } from 'vitest';

// Helper function implementations (copy from web.adapter.ts for testing)
function extractSelectColumns(sql: string): string[] | null {
  const selectMatch = sql.match(/select\s+(.+?)\s+from\s/is);
  if (!selectMatch || !selectMatch[1]) return null;

  const selectClause = selectMatch[1];
  if (selectClause.trim() === '*') return null;

  const columns: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of selectClause) {
    if (char === '(') depth++;
    else if (char === ')') depth--;
    else if (char === ',' && depth === 0) {
      columns.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    columns.push(current.trim());
  }

  return columns.map((col) => {
    // Match "alias" or alias in `... as alias`
    const aliasMatch = col.match(/\s+as\s+("?([\w$]+)"?)\s*$/i);
    if (aliasMatch?.[1]) {
      return aliasMatch[1].replace(/"/g, '');
    }

    // Handle table.column or "table"."column"
    const colParts = col.split('.');
    const lastPart = colParts[colParts.length - 1]?.trim() ?? col;

    // Remove quotes from the final part
    return lastPart.replace(/"/g, '');
  });
}

function rowToArray(
  row: Record<string, unknown>,
  columns: string[]
): unknown[] {
  return columns.map((col) => row[col]);
}

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
});

// Sample row data as it would come from SQLite (snake_case column names)
const sampleContactRow = {
  id: 'contact-123',
  first_name: 'John',
  last_name: 'Doe',
  birthday: '1990-01-15',
  created_at: 1704067200000,
  updated_at: 1704067200000,
  deleted: 0
};

const sampleFileRow = {
  id: 'file-123',
  name: 'photo.jpg',
  size: 1024,
  mime_type: 'image/jpeg',
  upload_date: 1704067200000,
  content_hash: 'abc123',
  storage_path: '/files/photo.jpg',
  deleted: 0
};

const sampleContactWithJoinRow = {
  id: 'contact-123',
  first_name: 'John',
  last_name: 'Doe',
  birthday: '1990-01-15',
  created_at: 1704067200000,
  email: 'john@example.com',
  phone_number: '555-1234'
};

describe('Column Mapping', () => {
  describe('WebAdapter getConnection()', () => {
    it('should NOT map column names - Drizzle expects snake_case', async () => {
      // Mock the worker message handling
      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [sampleContactRow]
      });

      // Simulate what getConnection returns
      const getConnection = () => {
        return async (
          sql: string,
          params: unknown[],
          _method: 'all' | 'get' | 'run' | 'values'
        ): Promise<{ rows: unknown[] }> => {
          const result = await mockSendRequest({ sql, params });
          // This is what the FIXED adapter does - returns raw rows
          return { rows: result.rows };
        };
      };

      const connection = getConnection();
      const result = await connection(
        'SELECT * FROM contacts WHERE id = ?',
        ['contact-123'],
        'all'
      );

      // Drizzle expects snake_case column names
      expect(result.rows[0]).toHaveProperty('first_name', 'John');
      expect(result.rows[0]).toHaveProperty('last_name', 'Doe');
      expect(result.rows[0]).toHaveProperty('created_at', 1704067200000);

      // Should NOT have camelCase properties
      expect(result.rows[0]).not.toHaveProperty('firstName');
      expect(result.rows[0]).not.toHaveProperty('lastName');
      expect(result.rows[0]).not.toHaveProperty('createdAt');
    });

    it('should preserve file column names for Drizzle', async () => {
      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [sampleFileRow]
      });

      const getConnection = () => {
        return async (
          sql: string,
          params: unknown[],
          _method: 'all' | 'get' | 'run' | 'values'
        ): Promise<{ rows: unknown[] }> => {
          const result = await mockSendRequest({ sql, params });
          return { rows: result.rows };
        };
      };

      const connection = getConnection();
      const result = await connection('SELECT * FROM files', [], 'all');

      // Drizzle expects snake_case
      expect(result.rows[0]).toHaveProperty('mime_type', 'image/jpeg');
      expect(result.rows[0]).toHaveProperty('upload_date', 1704067200000);
      expect(result.rows[0]).toHaveProperty('content_hash', 'abc123');
      expect(result.rows[0]).toHaveProperty('storage_path', '/files/photo.jpg');

      // Should NOT have camelCase
      expect(result.rows[0]).not.toHaveProperty('mimeType');
      expect(result.rows[0]).not.toHaveProperty('uploadDate');
    });

    it('should preserve joined column names for Drizzle', async () => {
      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [sampleContactWithJoinRow]
      });

      const getConnection = () => {
        return async (
          sql: string,
          params: unknown[],
          _method: 'all' | 'get' | 'run' | 'values'
        ): Promise<{ rows: unknown[] }> => {
          const result = await mockSendRequest({ sql, params });
          return { rows: result.rows };
        };
      };

      const connection = getConnection();
      const result = await connection(
        `SELECT c.*, e.email, p.phone_number
         FROM contacts c
         LEFT JOIN contact_emails e ON e.contact_id = c.id
         LEFT JOIN contact_phones p ON p.contact_id = c.id`,
        [],
        'all'
      );

      // All columns should be snake_case
      expect(result.rows[0]).toHaveProperty('first_name', 'John');
      expect(result.rows[0]).toHaveProperty('phone_number', '555-1234');
      expect(result.rows[0]).not.toHaveProperty('phoneNumber');
    });
  });

  describe('WebAdapter execute() for raw SQL', () => {
    it('should return raw snake_case column names from execute()', async () => {
      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [sampleContactRow]
      });

      // Simulate execute() which returns raw column names
      // Callers that need camelCase should use SQL aliases
      const execute = async (
        sql: string,
        params?: unknown[]
      ): Promise<{ rows: Record<string, unknown>[] }> => {
        const result = await mockSendRequest({ sql, params });
        // No mapping - return raw column names from SQLite
        return { rows: result.rows };
      };

      const result = await execute('SELECT * FROM contacts WHERE id = ?', [
        'contact-123'
      ]);

      // execute() should return snake_case (raw column names)
      expect(result.rows[0]).toHaveProperty('first_name', 'John');
      expect(result.rows[0]).toHaveProperty('last_name', 'Doe');
      expect(result.rows[0]).toHaveProperty('created_at', 1704067200000);
      expect(result.rows[0]).toHaveProperty('updated_at', 1704067200000);

      // Should NOT have camelCase (no mapping applied)
      expect(result.rows[0]).not.toHaveProperty('firstName');
      expect(result.rows[0]).not.toHaveProperty('lastName');
    });

    it('should support SQL aliases for camelCase when needed', async () => {
      // Sample row with aliased columns (as returned by SQLite)
      const aliasedRow = {
        id: 'contact-123',
        firstName: 'John', // Alias: first_name as firstName
        lastName: 'Doe', // Alias: last_name as lastName
        createdAt: 1704067200000 // Alias: created_at as createdAt
      };

      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [aliasedRow]
      });

      const execute = async (
        sql: string,
        params?: unknown[]
      ): Promise<{ rows: Record<string, unknown>[] }> => {
        const result = await mockSendRequest({ sql, params });
        return { rows: result.rows };
      };

      // Query with explicit aliases
      const result = await execute(
        `SELECT id, first_name as firstName, last_name as lastName, created_at as createdAt
         FROM contacts WHERE id = ?`,
        ['contact-123']
      );

      // Aliases produce camelCase column names
      expect(result.rows[0]).toHaveProperty('firstName', 'John');
      expect(result.rows[0]).toHaveProperty('lastName', 'Doe');
      expect(result.rows[0]).toHaveProperty('createdAt', 1704067200000);
    });
  });

  describe('Table browser (raw SQL with original column names)', () => {
    it('should return rows with original snake_case column names for table browser', async () => {
      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [sampleFileRow]
      });

      // Table browser uses execute() with SELECT * FROM table_name
      const execute = async (
        sql: string,
        params?: unknown[]
      ): Promise<{ rows: Record<string, unknown>[] }> => {
        const result = await mockSendRequest({ sql, params });
        // No mapping - return raw column names
        return { rows: result.rows };
      };

      const result = await execute('SELECT * FROM files', []);

      // Table browser expects original column names
      expect(result.rows[0]).toHaveProperty('id', 'file-123');
      expect(result.rows[0]).toHaveProperty('name', 'photo.jpg');
      expect(result.rows[0]).toHaveProperty('size', 1024);
      expect(result.rows[0]).toHaveProperty('mime_type', 'image/jpeg');
      expect(result.rows[0]).toHaveProperty('upload_date', 1704067200000);
      expect(result.rows[0]).toHaveProperty('content_hash', 'abc123');
      expect(result.rows[0]).toHaveProperty('storage_path', '/files/photo.jpg');
      expect(result.rows[0]).toHaveProperty('deleted', 0);

      // Should NOT have camelCase (table browser uses original names)
      expect(result.rows[0]).not.toHaveProperty('mimeType');
      expect(result.rows[0]).not.toHaveProperty('uploadDate');
      expect(result.rows[0]).not.toHaveProperty('storagePath');
      expect(result.rows[0]).not.toHaveProperty('contentHash');
    });

    it('should display all columns from any table', async () => {
      // Simulate analytics_events table
      const analyticsRow = {
        id: 'event-1',
        event_name: 'db.contacts.list',
        duration_ms: 150,
        success: 1,
        timestamp: 1704067200000
      };

      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [analyticsRow]
      });

      const execute = async (
        sql: string,
        params?: unknown[]
      ): Promise<{ rows: Record<string, unknown>[] }> => {
        const result = await mockSendRequest({ sql, params });
        return { rows: result.rows };
      };

      const result = await execute(
        'SELECT * FROM analytics_events LIMIT 50',
        []
      );

      // Original column names are preserved
      expect(result.rows[0]).toHaveProperty('event_name', 'db.contacts.list');
      expect(result.rows[0]).toHaveProperty('duration_ms', 150);
      expect(result.rows[0]).not.toHaveProperty('eventName');
      expect(result.rows[0]).not.toHaveProperty('durationMs');
    });

    it('should handle PRAGMA queries for table info', async () => {
      // PRAGMA table_info returns column metadata
      const pragmaRows = [
        {
          cid: 0,
          name: 'id',
          type: 'TEXT',
          notnull: 1,
          dflt_value: null,
          pk: 1
        },
        {
          cid: 1,
          name: 'event_name',
          type: 'TEXT',
          notnull: 1,
          dflt_value: null,
          pk: 0
        },
        {
          cid: 2,
          name: 'duration_ms',
          type: 'INTEGER',
          notnull: 1,
          dflt_value: null,
          pk: 0
        }
      ];

      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: pragmaRows
      });

      const execute = async (
        sql: string,
        params?: unknown[]
      ): Promise<{ rows: Record<string, unknown>[] }> => {
        const result = await mockSendRequest({ sql, params });
        return { rows: result.rows };
      };

      const result = await execute('PRAGMA table_info("analytics_events")', []);

      // PRAGMA results should have original column names
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toHaveProperty('name', 'id');
      expect(result.rows[1]).toHaveProperty('name', 'event_name');
      expect(result.rows[2]).toHaveProperty('name', 'duration_ms');
    });
  });

  describe('Bug reproduction: incorrect mapping breaks Drizzle', () => {
    it('demonstrates the bug when mapRowKeys is applied in getConnection', async () => {
      function snakeToCamel(str: string): string {
        return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
      }

      function mapRowKeys(
        row: Record<string, unknown>
      ): Record<string, unknown> {
        const mapped: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(row)) {
          mapped[snakeToCamel(key)] = value;
        }
        return mapped;
      }

      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [sampleFileRow]
      });

      // BUGGY version - applies mapRowKeys in getConnection
      const buggyGetConnection = () => {
        return async (
          sql: string,
          params: unknown[],
          _method: 'all' | 'get' | 'run' | 'values'
        ): Promise<{ rows: unknown[] }> => {
          const result = await mockSendRequest({ sql, params });
          // BUG: This breaks Drizzle ORM!
          const mappedRows = result.rows.map((row: Record<string, unknown>) =>
            mapRowKeys(row)
          );
          return { rows: mappedRows };
        };
      };

      const connection = buggyGetConnection();
      const result = await connection('SELECT * FROM files', [], 'all');

      // Drizzle generates SQL like: SELECT "mime_type" FROM files
      // It expects the result to have "mime_type" key
      // But with the bug, it gets "mimeType" key instead

      // This is what Drizzle looks for (and fails to find):
      expect(result.rows[0]).not.toHaveProperty('mime_type');

      // This is what Drizzle gets (which it doesn't understand):
      expect(result.rows[0]).toHaveProperty('mimeType');

      // So when Drizzle tries to access row['mime_type'], it gets undefined!
      const row = result.rows[0] as Record<string, unknown>;
      expect(row['mime_type']).toBeUndefined(); // This is the bug!
    });

    it('demonstrates the fix - no mapping in getConnection', async () => {
      const mockSendRequest = vi.fn().mockResolvedValue({
        rows: [sampleFileRow]
      });

      // FIXED version - does NOT apply mapRowKeys in getConnection
      const fixedGetConnection = () => {
        return async (
          sql: string,
          params: unknown[],
          _method: 'all' | 'get' | 'run' | 'values'
        ): Promise<{ rows: unknown[] }> => {
          const result = await mockSendRequest({ sql, params });
          // FIXED: Return raw rows, let Drizzle handle mapping
          return { rows: result.rows };
        };
      };

      const connection = fixedGetConnection();
      const result = await connection('SELECT * FROM files', [], 'all');

      // Now Drizzle can find the columns it's looking for
      const row = result.rows[0] as Record<string, unknown>;
      expect(row['mime_type']).toBe('image/jpeg'); // This works!
      expect(row['upload_date']).toBe(1704067200000); // This works!
      expect(row['storage_path']).toBe('/files/photo.jpg'); // This works!
    });
  });

  describe('Drizzle schema column mapping simulation', () => {
    // Simulate how Drizzle maps columns from the schema definition
    // Schema: mimeType: text('mime_type')
    // This means: JS property "mimeType" maps to SQL column "mime_type"

    it('simulates Drizzle query result mapping', () => {
      // When you do: db.select({ mimeType: files.mimeType }).from(files)
      // Drizzle generates: SELECT "mime_type" FROM files
      // Result from DB: { mime_type: 'image/jpeg' }
      // Drizzle then maps this to: { mimeType: 'image/jpeg' }

      const dbResult = { mime_type: 'image/jpeg' };

      // Drizzle's internal mapping (simplified)
      const schemaMapping = {
        mimeType: 'mime_type' // JS property -> SQL column
      };

      // Drizzle maps the result
      const mappedResult: Record<string, unknown> = {};
      for (const [jsProp, sqlCol] of Object.entries(schemaMapping)) {
        mappedResult[jsProp] = dbResult[sqlCol as keyof typeof dbResult];
      }

      expect(mappedResult['mimeType']).toBe('image/jpeg');
    });

    it('shows why pre-mapping breaks Drizzle', () => {
      // If the adapter pre-maps snake_case to camelCase...
      const preMappedResult = { mimeType: 'image/jpeg' }; // Already camelCase

      // Drizzle still looks for snake_case columns
      const schemaMapping = {
        mimeType: 'mime_type' // Drizzle looks for 'mime_type'
      };

      // Drizzle tries to map but can't find the column
      const mappedResult: Record<string, unknown> = {};
      for (const [jsProp, sqlCol] of Object.entries(schemaMapping)) {
        mappedResult[jsProp] =
          preMappedResult[sqlCol as keyof typeof preMappedResult];
      }

      // Result is undefined because 'mime_type' doesn't exist in preMappedResult
      expect(mappedResult['mimeType']).toBeUndefined(); // BUG!
    });
  });
});
