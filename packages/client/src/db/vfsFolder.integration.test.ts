/**
 * Integration tests for VFS folder creation with real SQLite foreign key constraints.
 *
 * These tests verify that:
 * 1. Creating a folder when VFS root doesn't exist properly creates the root first
 * 2. Foreign key constraints are satisfied when inserting into vfs_links
 * 3. The fix for SQLITE_CONSTRAINT_FOREIGNKEY works correctly
 */

// Import integration setup FIRST - this sets up mocks for adapters and key manager
import '../test/setupIntegration';

import { vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import { resetTestKeyManager } from '@tearleads/db-test-utils';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDatabaseAdapter, resetDatabase, setupDatabase } from '.';

const TEST_PASSWORD = 'test-password-123';
const TEST_INSTANCE_ID = 'test-instance';
const VFS_ROOT_ID = '__vfs_root__';

describe('VFS Folder Integration Tests', () => {
  beforeEach(async () => {
    await resetTestKeyManager();
    await resetDatabase(TEST_INSTANCE_ID);
  });

  describe('foreign key constraints', () => {
    it('succeeds when VFS root is created before inserting vfs_links', async () => {
      await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);
      const adapter = getDatabaseAdapter();

      const folderId = 'test-folder-id';
      const linkId = 'test-link-id';
      const now = Date.now();

      // 1. Create VFS root in vfs_registry first
      await adapter.execute(
        `INSERT INTO vfs_registry (id, object_type, owner_id, created_at) VALUES (?, ?, ?, ?)`,
        [VFS_ROOT_ID, 'folder', null, now]
      );

      // 2. Create the new folder in vfs_registry
      await adapter.execute(
        `INSERT INTO vfs_registry (id, object_type, owner_id, created_at) VALUES (?, ?, ?, ?)`,
        [folderId, 'folder', null, now]
      );

      // 3. Create the link - should succeed now
      await adapter.execute(
        `INSERT INTO vfs_links (id, parent_id, child_id, wrapped_session_key, created_at) VALUES (?, ?, ?, ?, ?)`,
        [linkId, VFS_ROOT_ID, folderId, '', now]
      );

      // Verify the link was created
      const result = await adapter.execute(
        `SELECT * FROM vfs_links WHERE id = ?`,
        [linkId]
      );
      expect(result.rows).toHaveLength(1);
    });
  });

  describe('VFS folder creation with Drizzle ORM', () => {
    it('creates folder with VFS root check using transaction', async () => {
      const db = await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      const folderId = 'drizzle-folder-id';
      const linkId = 'drizzle-link-id';
      const now = new Date();

      // Simulate the fixed useCreateVfsFolder logic using onConflictDoNothing
      await db.transaction(async (tx) => {
        // Insert VFS root with onConflictDoNothing to handle race conditions
        await tx
          .insert(vfsRegistry)
          .values({
            id: VFS_ROOT_ID,
            objectType: 'folder',
            ownerId: null,
            encryptedSessionKey: null,
            encryptedName: 'VFS Root',
            createdAt: now
          })
          .onConflictDoNothing();

        // Create the new folder
        await tx.insert(vfsRegistry).values({
          id: folderId,
          objectType: 'folder',
          ownerId: null,
          encryptedSessionKey: null,
          encryptedName: 'Test Folder',
          createdAt: now
        });

        // Create the link to VFS root
        await tx.insert(vfsLinks).values({
          id: linkId,
          parentId: VFS_ROOT_ID,
          childId: folderId,
          wrappedSessionKey: '',
          createdAt: now
        });
      });

      // Verify VFS root was created
      const rootResult = await db
        .select()
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, VFS_ROOT_ID));
      expect(rootResult).toHaveLength(1);
      expect(rootResult[0]?.objectType).toBe('folder');

      // Verify the folder was created
      const folderResult = await db
        .select()
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, folderId));
      expect(folderResult).toHaveLength(1);
      expect(folderResult[0]?.objectType).toBe('folder');
      expect(folderResult[0]?.encryptedName).toBe('Test Folder');

      // Verify the link was created
      const linkResult = await db
        .select()
        .from(vfsLinks)
        .where(eq(vfsLinks.id, linkId));
      expect(linkResult).toHaveLength(1);
      expect(linkResult[0]?.parentId).toBe(VFS_ROOT_ID);
      expect(linkResult[0]?.childId).toBe(folderId);
    });

    it('does not duplicate VFS root if it already exists', async () => {
      const db = await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      const now = new Date();

      // Create VFS root first
      await db.insert(vfsRegistry).values({
        id: VFS_ROOT_ID,
        objectType: 'folder',
        ownerId: null,
        encryptedSessionKey: null,
        encryptedName: 'VFS Root',
        createdAt: now
      });

      // Now create a folder using the same logic as useCreateVfsFolder
      const folderId = 'second-folder-id';
      const linkId = 'second-link-id';

      await db.transaction(async (tx) => {
        // Use onConflictDoNothing - VFS root already exists, so this is a no-op
        await tx
          .insert(vfsRegistry)
          .values({
            id: VFS_ROOT_ID,
            objectType: 'folder',
            ownerId: null,
            encryptedSessionKey: null,
            encryptedName: 'VFS Root',
            createdAt: now
          })
          .onConflictDoNothing();

        // Create the new folder
        await tx.insert(vfsRegistry).values({
          id: folderId,
          objectType: 'folder',
          ownerId: null,
          encryptedSessionKey: null,
          encryptedName: 'Second Folder',
          createdAt: now
        });

        // Create the link
        await tx.insert(vfsLinks).values({
          id: linkId,
          parentId: VFS_ROOT_ID,
          childId: folderId,
          wrappedSessionKey: '',
          createdAt: now
        });
      });

      // Verify only one VFS root exists
      const rootResults = await db
        .select()
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, VFS_ROOT_ID));
      expect(rootResults).toHaveLength(1);

      // Verify the new folder exists in canonical vfs_registry metadata
      const folderResults = await db
        .select()
        .from(vfsRegistry)
        .where(eq(vfsRegistry.id, folderId));
      expect(folderResults).toHaveLength(1);
      expect(folderResults[0]?.encryptedName).toBe('Second Folder');
    });

    it('creates nested folder under existing parent', async () => {
      const db = await setupDatabase(TEST_PASSWORD, TEST_INSTANCE_ID);

      const parentFolderId = 'parent-folder-id';
      const childFolderId = 'child-folder-id';
      const parentLinkId = 'parent-link-id';
      const childLinkId = 'child-link-id';
      const now = new Date();

      // First create VFS root and parent folder
      await db.transaction(async (tx) => {
        // Create VFS root
        await tx.insert(vfsRegistry).values({
          id: VFS_ROOT_ID,
          objectType: 'folder',
          ownerId: null,
          encryptedSessionKey: null,
          encryptedName: 'VFS Root',
          createdAt: now
        });

        // Create parent folder
        await tx.insert(vfsRegistry).values({
          id: parentFolderId,
          objectType: 'folder',
          ownerId: null,
          encryptedSessionKey: null,
          encryptedName: 'Parent Folder',
          createdAt: now
        });

        // Link parent to root
        await tx.insert(vfsLinks).values({
          id: parentLinkId,
          parentId: VFS_ROOT_ID,
          childId: parentFolderId,
          wrappedSessionKey: '',
          createdAt: now
        });
      });

      // Now create child folder under parent (not VFS root)
      await db.transaction(async (tx) => {
        // Create child folder
        await tx.insert(vfsRegistry).values({
          id: childFolderId,
          objectType: 'folder',
          ownerId: null,
          encryptedSessionKey: null,
          encryptedName: 'Child Folder',
          createdAt: now
        });

        // Link child to parent (should work without VFS root check)
        await tx.insert(vfsLinks).values({
          id: childLinkId,
          parentId: parentFolderId,
          childId: childFolderId,
          wrappedSessionKey: '',
          createdAt: now
        });
      });

      // Verify the child link exists with correct parent
      const linkResult = await db
        .select()
        .from(vfsLinks)
        .where(eq(vfsLinks.id, childLinkId));
      expect(linkResult).toHaveLength(1);
      expect(linkResult[0]?.parentId).toBe(parentFolderId);
      expect(linkResult[0]?.childId).toBe(childFolderId);
    });
  });
});
