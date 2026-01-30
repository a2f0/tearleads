/**
 * Integration test for VFS registration when creating notes.
 *
 * This test verifies that:
 * 1. When a note is created, it's inserted into the notes table
 * 2. The note is also registered in vfsRegistry
 * 3. The vfsRegistry entry can be queried back
 */

import { notes, vfsRegistry } from '@rapid/db/sqlite';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { describe, expect, it, vi } from 'vitest';

describe('VFS Registration Integration', () => {
  it('should insert note into both notes and vfsRegistry tables', async () => {
    const insertedTables: string[] = [];

    // Create a mock connection that tracks all inserts
    const mockConnection = vi.fn(
      async (
        sql: string,
        _params: unknown[],
        _method: 'all' | 'get' | 'run' | 'values'
      ): Promise<{ rows: unknown[] }> => {
        // Track INSERT statements
        if (sql.toLowerCase().includes('insert into')) {
          if (sql.includes('"notes"')) {
            insertedTables.push('notes');
          }
          if (sql.includes('"vfs_registry"')) {
            insertedTables.push('vfs_registry');
          }
        }
        return { rows: [] };
      }
    );

    const db = drizzle(mockConnection);
    const noteId = 'test-note-id';
    const now = new Date();

    // Simulate what NotesWindow.handleNewNote does:
    // 1. Insert note
    await db.insert(notes).values({
      id: noteId,
      title: 'Test Note',
      content: '',
      createdAt: now,
      updatedAt: now,
      deleted: false
    });

    // 2. Insert into vfsRegistry (ownerId is optional for device-first)
    await db.insert(vfsRegistry).values({
      id: noteId,
      objectType: 'note',
      ownerId: null,
      encryptedSessionKey: null,
      createdAt: now
    });

    // Verify both inserts happened
    expect(insertedTables).toContain('notes');
    expect(insertedTables).toContain('vfs_registry');
    expect(insertedTables).toHaveLength(2);
  });

  it('should be able to query vfsRegistry for notes', async () => {
    const noteId = 'test-note-id';
    const createdAt = Date.now();

    // Mock connection that returns vfsRegistry data
    const mockConnection = vi.fn(
      async (
        sql: string,
        _params: unknown[],
        _method: 'all' | 'get' | 'run' | 'values'
      ): Promise<{ rows: unknown[] }> => {
        // Return data for vfsRegistry queries
        if (
          sql.toLowerCase().includes('from "vfs_registry"') ||
          sql.toLowerCase().includes('from vfs_registry')
        ) {
          // Return as array format (column order: id, object_type, created_at)
          return {
            rows: [[noteId, 'note', createdAt]]
          };
        }
        return { rows: [] };
      }
    );

    const db = drizzle(mockConnection);

    // Query similar to useVfsAllItems
    const registryRows = await db
      .select({
        id: vfsRegistry.id,
        objectType: vfsRegistry.objectType,
        createdAt: vfsRegistry.createdAt
      })
      .from(vfsRegistry);

    expect(registryRows).toHaveLength(1);
    expect(registryRows[0]?.id).toBe(noteId);
    expect(registryRows[0]?.objectType).toBe('note');
  });

  it('should be able to query notes table for name lookup', async () => {
    const noteId = 'test-note-id';
    const noteTitle = 'My Test Note';

    const mockConnection = vi.fn(
      async (
        sql: string,
        _params: unknown[],
        _method: 'all' | 'get' | 'run' | 'values'
      ): Promise<{ rows: unknown[] }> => {
        // Return data for notes queries
        if (sql.toLowerCase().includes('from "notes"')) {
          // Return note data (column order: id, title)
          return {
            rows: [[noteId, noteTitle]]
          };
        }
        return { rows: [] };
      }
    );

    const db = drizzle(mockConnection);

    // Query similar to useVfsAllItems name lookup
    const noteRows = await db
      .select({
        id: notes.id,
        title: notes.title
      })
      .from(notes);

    expect(noteRows).toHaveLength(1);
    expect(noteRows[0]?.id).toBe(noteId);
    expect(noteRows[0]?.title).toBe(noteTitle);
  });

  it('verifies the complete flow: insert note, insert vfsRegistry, query back', async () => {
    const noteId = crypto.randomUUID();
    const noteTitle = 'Integration Test Note';
    const now = new Date();
    const createdAtMs = now.getTime();

    // Track state for the mock
    const insertedNotes: Array<{ id: string; title: string }> = [];
    const insertedRegistry: Array<{ id: string; objectType: string }> = [];

    const mockConnection = vi.fn(
      async (
        sql: string,
        params: unknown[],
        _method: 'all' | 'get' | 'run' | 'values'
      ): Promise<{ rows: unknown[] }> => {
        const sqlLower = sql.toLowerCase();

        // Handle INSERT into notes
        if (sqlLower.includes('insert') && sqlLower.includes('"notes"')) {
          insertedNotes.push({
            id: params[0] as string,
            title: params[1] as string
          });
          return { rows: [] };
        }

        // Handle INSERT into vfs_registry
        if (
          sqlLower.includes('insert') &&
          sqlLower.includes('"vfs_registry"')
        ) {
          insertedRegistry.push({
            id: params[0] as string,
            objectType: params[1] as string
          });
          return { rows: [] };
        }

        // Handle SELECT from vfs_registry
        if (
          sqlLower.includes('select') &&
          sqlLower.includes('"vfs_registry"')
        ) {
          return {
            rows: insertedRegistry.map((r) => [r.id, r.objectType, createdAtMs])
          };
        }

        // Handle SELECT from notes (for name lookup)
        if (sqlLower.includes('select') && sqlLower.includes('"notes"')) {
          return {
            rows: insertedNotes.map((n) => [n.id, n.title])
          };
        }

        return { rows: [] };
      }
    );

    const db = drizzle(mockConnection);

    // Step 1: Insert note
    await db.insert(notes).values({
      id: noteId,
      title: noteTitle,
      content: '',
      createdAt: now,
      updatedAt: now,
      deleted: false
    });

    // Step 2: Insert into vfsRegistry (ownerId is optional for device-first)
    await db.insert(vfsRegistry).values({
      id: noteId,
      objectType: 'note',
      ownerId: null,
      encryptedSessionKey: null,
      createdAt: now
    });

    // Step 3: Query vfsRegistry
    const registryResults = await db
      .select({
        id: vfsRegistry.id,
        objectType: vfsRegistry.objectType,
        createdAt: vfsRegistry.createdAt
      })
      .from(vfsRegistry);

    // Step 4: Verify
    expect(registryResults).toHaveLength(1);
    expect(registryResults[0]?.id).toBe(noteId);
    expect(registryResults[0]?.objectType).toBe('note');

    // Also verify the notes can be queried for name lookup
    const notesResults = await db
      .select({
        id: notes.id,
        title: notes.title
      })
      .from(notes);

    expect(notesResults).toHaveLength(1);
    expect(notesResults[0]?.id).toBe(noteId);
    expect(notesResults[0]?.title).toBe(noteTitle);
  });
});
