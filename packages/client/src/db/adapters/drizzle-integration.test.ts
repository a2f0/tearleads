/**
 * Integration tests for Drizzle ORM with sqlite-proxy adapter.
 *
 * These tests verify that:
 * 1. Drizzle queries return data with correct property names
 * 2. The sqlite-proxy adapter is compatible with Drizzle's expectations
 */

import { desc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { describe, expect, it, vi } from 'vitest';
import * as schema from '../schema';

// Sample row data as ARRAYS in SELECT column order (what the fixed adapter returns)
// For file queries: id, name, size, mime_type, upload_date, storage_path, deleted (7 columns)
const sampleFileRows = [
  [
    'file-1',
    'photo.jpg',
    1024,
    'image/jpeg',
    1704067200000,
    '/files/photo.jpg',
    0
  ],
  [
    'file-2',
    'document.pdf',
    2048,
    'application/pdf',
    1704153600000,
    '/files/document.pdf',
    0
  ]
];

// For contact queries: id, first_name, last_name, birthday, created_at, deleted (6 columns)
const sampleContactRows = [
  ['contact-1', 'John', 'Doe', '1990-01-15', 1704067200000, 0],
  ['contact-2', 'Jane', 'Smith', null, 1704153600000, 0]
];

describe('Drizzle sqlite-proxy Integration', () => {
  describe('File queries', () => {
    it('should return files with correct camelCase property names', async () => {
      // Create a mock connection function that returns snake_case columns
      const mockConnection = vi.fn(
        async (
          _sql: string,
          _params: unknown[],
          _method: 'all' | 'get' | 'run' | 'values'
        ): Promise<{ rows: unknown[] }> => {
          // Return snake_case column names (as SQLite does)
          return { rows: sampleFileRows };
        }
      );

      // Create Drizzle instance with the mock connection
      const db = drizzle(mockConnection, { schema });

      // Execute a query similar to what Files.tsx does
      const result = await db
        .select({
          id: schema.files.id,
          name: schema.files.name,
          size: schema.files.size,
          mimeType: schema.files.mimeType,
          uploadDate: schema.files.uploadDate,
          storagePath: schema.files.storagePath,
          deleted: schema.files.deleted
        })
        .from(schema.files)
        .orderBy(desc(schema.files.uploadDate));

      // Debug: log what we got
      console.log('Query result:', JSON.stringify(result, null, 2));

      // Verify we got the expected number of rows
      expect(result).toHaveLength(2);

      // Verify first file has correct camelCase properties
      const firstFile = result[0];
      expect(firstFile).toBeDefined();

      // These should work if Drizzle correctly maps snake_case to camelCase
      expect(firstFile?.id).toBe('file-1');
      expect(firstFile?.name).toBe('photo.jpg');
      expect(firstFile?.size).toBe(1024);
      expect(firstFile?.mimeType).toBe('image/jpeg');
      expect(firstFile?.storagePath).toBe('/files/photo.jpg');

      // Check uploadDate - Drizzle with mode: 'timestamp_ms' should convert to Date
      expect(firstFile?.uploadDate).toBeInstanceOf(Date);
      expect((firstFile?.uploadDate as Date)?.getTime()).toBe(1704067200000);

      // Check deleted boolean conversion
      expect(firstFile?.deleted).toBe(false);
    });

    it('should handle empty result set', async () => {
      const mockConnection = vi.fn(async () => ({ rows: [] }));
      const db = drizzle(mockConnection, { schema });

      const result = await db.select().from(schema.files);

      expect(result).toHaveLength(0);
    });
  });

  describe('Contact queries', () => {
    it('should return contacts with correct camelCase property names', async () => {
      const mockConnection = vi.fn(async () => ({ rows: sampleContactRows }));
      const db = drizzle(mockConnection, { schema });

      const result = await db
        .select({
          id: schema.contacts.id,
          firstName: schema.contacts.firstName,
          lastName: schema.contacts.lastName,
          birthday: schema.contacts.birthday,
          createdAt: schema.contacts.createdAt,
          deleted: schema.contacts.deleted
        })
        .from(schema.contacts)
        .where(eq(schema.contacts.deleted, false));

      console.log('Contact query result:', JSON.stringify(result, null, 2));

      expect(result).toHaveLength(2);

      const firstContact = result[0];
      expect(firstContact).toBeDefined();
      expect(firstContact?.id).toBe('contact-1');
      expect(firstContact?.firstName).toBe('John');
      expect(firstContact?.lastName).toBe('Doe');
      expect(firstContact?.birthday).toBe('1990-01-15');
      expect(firstContact?.createdAt).toBeInstanceOf(Date);
      expect(firstContact?.deleted).toBe(false);

      // Check nullable fields
      const secondContact = result[1];
      expect(secondContact?.birthday).toBeNull();
    });
  });

  describe('Contact with JOIN queries', () => {
    it('should return contacts with joined email/phone data', async () => {
      // Simulate a LEFT JOIN result as array (column order matches SELECT clause)
      // SELECT id, first_name, last_name, birthday, created_at, email, phone_number
      const joinedRows = [
        [
          'contact-1',
          'John',
          'Doe',
          '1990-01-15',
          1704067200000,
          'john@example.com',
          '555-1234'
        ]
      ];

      const mockConnection = vi.fn(async () => ({ rows: joinedRows }));
      const db = drizzle(mockConnection, { schema });

      // Execute a query similar to what Contacts.tsx does
      const result = await db
        .select({
          id: schema.contacts.id,
          firstName: schema.contacts.firstName,
          lastName: schema.contacts.lastName,
          birthday: schema.contacts.birthday,
          createdAt: schema.contacts.createdAt,
          primaryEmail: schema.contactEmails.email,
          primaryPhone: schema.contactPhones.phoneNumber
        })
        .from(schema.contacts)
        .leftJoin(
          schema.contactEmails,
          eq(schema.contactEmails.contactId, schema.contacts.id)
        )
        .leftJoin(
          schema.contactPhones,
          eq(schema.contactPhones.contactId, schema.contacts.id)
        );

      console.log('JOIN query result:', JSON.stringify(result, null, 2));

      expect(result).toHaveLength(1);

      const contact = result[0];
      expect(contact).toBeDefined();
      expect(contact?.id).toBe('contact-1');
      expect(contact?.firstName).toBe('John');
      expect(contact?.lastName).toBe('Doe');
      expect(contact?.primaryEmail).toBe('john@example.com');
      expect(contact?.primaryPhone).toBe('555-1234');
    });
  });

  describe('SQL generation verification', () => {
    it('should generate SQL with snake_case column names', async () => {
      let capturedSql = '';
      const mockConnection = vi.fn(
        async (
          sql: string,
          _params: unknown[],
          _method: 'all' | 'get' | 'run' | 'values'
        ) => {
          capturedSql = sql;
          return { rows: [] };
        }
      );

      const db = drizzle(mockConnection, { schema });

      await db
        .select({
          mimeType: schema.files.mimeType,
          uploadDate: schema.files.uploadDate
        })
        .from(schema.files);

      console.log('Generated SQL:', capturedSql);

      // Drizzle should generate SQL with snake_case column names
      expect(capturedSql).toContain('mime_type');
      expect(capturedSql).toContain('upload_date');

      // Should NOT contain camelCase in the SQL
      expect(capturedSql).not.toContain('mimeType');
      expect(capturedSql).not.toContain('uploadDate');
    });
  });

  describe('Column key matching', () => {
    it('should log what Drizzle expects vs what we provide', async () => {
      const mockRow = {
        id: 'file-1',
        name: 'test.jpg',
        size: 100,
        mime_type: 'image/jpeg',
        upload_date: 1704067200000,
        content_hash: 'abc',
        storage_path: '/test',
        deleted: 0
      };

      const mockConnection = vi.fn(
        async (
          sql: string,
          _params: unknown[],
          _method: 'all' | 'get' | 'run' | 'values'
        ) => {
          console.log('SQL executed:', sql);
          console.log('Returning row with keys:', Object.keys(mockRow));
          return { rows: [mockRow] };
        }
      );

      const db = drizzle(mockConnection, { schema });

      // Use select() without custom mapping to see default behavior
      const result = await db.select().from(schema.files);

      console.log('Full select() result:', JSON.stringify(result, null, 2));
      console.log('Result keys:', result[0] ? Object.keys(result[0]) : []);

      // Try to access fields
      const row = result[0];
      if (row) {
        console.log('row.id:', row.id);
        console.log('row.name:', row.name);
        console.log('row.mimeType:', row.mimeType);
        console.log('row.uploadDate:', row.uploadDate);
        console.log(
          'row["mime_type"]:',
          (row as unknown as Record<string, unknown>)['mime_type']
        );
        console.log(
          'row["upload_date"]:',
          (row as unknown as Record<string, unknown>)['upload_date']
        );
      }

      expect(result).toHaveLength(1);
    });

    it('should work when returning rows as arrays (values format)', async () => {
      // According to drizzle-orm sqlite-proxy docs, rows should be arrays of values
      // in the same order as columns appear in the SELECT statement
      const mockConnection = vi.fn(
        async (
          sql: string,
          _params: unknown[],
          method: 'all' | 'get' | 'run' | 'values'
        ) => {
          console.log('SQL:', sql);
          console.log('Method:', method);

          // For a query like: select "id", "name", "size", "mime_type", ... from "files"
          // Return values in the same order
          const rowAsArray = [
            'file-1', // id
            'test.jpg', // name
            100, // size
            'image/jpeg', // mime_type
            1704067200000, // upload_date
            'abc', // content_hash
            '/test', // storage_path
            0 // deleted
          ];

          return { rows: [rowAsArray] };
        }
      );

      const db = drizzle(mockConnection, { schema });
      const result = await db.select().from(schema.files);

      console.log('Array format result:', JSON.stringify(result, null, 2));

      // Check if values are now populated
      const row = result[0];
      if (row) {
        console.log('row.id:', row.id);
        console.log('row.name:', row.name);
        console.log('row.mimeType:', row.mimeType);
      }
    });
  });
});
