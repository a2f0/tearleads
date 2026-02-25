/**
 * VFS seeding utilities for integration tests.
 *
 * Provides helpers to create VFS entries (folders, files, links) with
 * appropriate foreign key relationships.
 */

import type { Database } from '@tearleads/db/sqlite';
import { emailFolders, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';

/**
 * The VFS root folder ID.
 * This is a well-known ID that serves as the root of the VFS hierarchy.
 */
export const VFS_ROOT_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Options for seeding a folder.
 */
export interface SeedFolderOptions {
  /** Override the generated ID */
  id?: string;
  /** Encrypted folder name */
  name?: string;
  /** Parent folder ID (defaults to VFS_ROOT_ID) */
  parentId?: string;
  /** Owner user ID */
  ownerId?: string;
  /** Folder icon */
  icon?: string;
  /** View mode */
  viewMode?: string;
}

/**
 * Options for seeding a VFS registry item.
 */
export interface SeedVfsItemOptions {
  /** Override the generated ID */
  id?: string;
  /** Object type (e.g., 'folder', 'file', 'playlist') */
  objectType: string;
  /** Owner user ID */
  ownerId?: string;
  /** Parent folder ID for creating a link */
  parentId?: string;
  /** Whether to create a link to the parent (defaults to true if parentId is set) */
  createLink?: boolean;
}

/**
 * Ensures the VFS root exists in the database.
 *
 * Call this before creating any other VFS items to ensure foreign key
 * relationships are satisfied.
 */
export async function ensureVfsRoot(db: Database): Promise<void> {
  const now = new Date();

  await db
    .insert(vfsRegistry)
    .values({
      id: VFS_ROOT_ID,
      objectType: 'folder',
      ownerId: null,
      encryptedName: 'VFS Root',
      createdAt: now
    })
    .onConflictDoNothing();
}

/**
 * Seeds a VFS folder in the database.
 *
 * Creates entries in vfsRegistry and vfsLinks (linking to parent).
 * Automatically ensures the VFS root exists.
 *
 * @returns The folder ID
 *
 * @example
 * ```ts
 * const folderId = await seedFolder(db, { name: 'My Folder' });
 * ```
 */
export async function seedFolder(
  db: Database,
  options: SeedFolderOptions = {}
): Promise<string> {
  const {
    id = crypto.randomUUID(),
    name = `Folder-${id.slice(0, 8)}`,
    parentId = VFS_ROOT_ID,
    ownerId = null,
    icon,
    viewMode
  } = options;

  const now = new Date();

  // Ensure VFS root exists
  await ensureVfsRoot(db);

  // Create registry entry
  await db.insert(vfsRegistry).values({
    id,
    objectType: 'folder',
    ownerId,
    encryptedName: name,
    icon,
    viewMode,
    createdAt: now
  });

  // Create link to parent
  await db.insert(vfsLinks).values({
    id: crypto.randomUUID(),
    parentId,
    childId: id,
    wrappedSessionKey: 'test-wrapped-key',
    createdAt: now
  });

  return id;
}

/**
 * Seeds a generic VFS registry item in the database.
 *
 * Creates an entry in vfsRegistry and optionally a link to a parent.
 * Use this for item types that don't need additional table entries.
 *
 * @returns The item ID
 *
 * @example
 * ```ts
 * const itemId = await seedVfsItem(db, {
 *   objectType: 'file',
 *   parentId: folderId
 * });
 * ```
 */
export async function seedVfsItem(
  db: Database,
  options: SeedVfsItemOptions
): Promise<string> {
  const {
    id = crypto.randomUUID(),
    objectType,
    ownerId = null,
    parentId,
    createLink = parentId !== undefined
  } = options;

  const now = new Date();

  // Ensure VFS root exists if we're creating a link
  if (createLink && parentId) {
    await ensureVfsRoot(db);
  }

  // Create registry entry
  await db.insert(vfsRegistry).values({
    id,
    objectType,
    ownerId,
    createdAt: now
  });

  // Create link to parent if requested
  if (createLink && parentId) {
    await db.insert(vfsLinks).values({
      id: crypto.randomUUID(),
      parentId,
      childId: id,
      wrappedSessionKey: 'test-wrapped-key',
      createdAt: now
    });
  }

  return id;
}

/**
 * Options for seeding an email folder.
 */
export interface SeedEmailFolderOptions {
  /** Override the generated ID */
  id?: string;
  /** Email folder name (stored in email_folders.encrypted_name) */
  name: string;
  /** Folder type */
  folderType?: 'inbox' | 'sent' | 'drafts' | 'trash' | 'spam' | 'custom';
  /** Parent folder ID for link creation */
  parentId?: string;
}

/**
 * Seeds an email folder in the database.
 *
 * Creates entries in vfsRegistry (objectType: 'emailFolder'),
 * email_folders, and optionally vfsLinks.
 * Mirrors the creation flow in ClientEmailProvider.createFolder().
 *
 * @returns The email folder ID
 *
 * @example
 * ```ts
 * const folderId = await seedEmailFolder(db, { name: 'Inbox', folderType: 'inbox' });
 * ```
 */
export async function seedEmailFolder(
  db: Database,
  options: SeedEmailFolderOptions
): Promise<string> {
  const {
    id = crypto.randomUUID(),
    name,
    folderType = 'custom',
    parentId
  } = options;

  const now = new Date();

  if (parentId) {
    await ensureVfsRoot(db);
  }

  // Create VFS registry entry (no encryptedName - matches real creation flow)
  await db.insert(vfsRegistry).values({
    id,
    objectType: 'emailFolder',
    ownerId: null,
    createdAt: now
  });

  // Create email_folders entry with the name
  await db.insert(emailFolders).values({
    id,
    encryptedName: name,
    folderType,
    unreadCount: 0
  });

  // Create link to parent if provided
  if (parentId) {
    await db.insert(vfsLinks).values({
      id: crypto.randomUUID(),
      parentId,
      childId: id,
      wrappedSessionKey: 'test-wrapped-key',
      createdAt: now
    });
  }

  return id;
}

/**
 * Seeds a link between two VFS items.
 *
 * @returns The link ID
 *
 * @example
 * ```ts
 * const linkId = await seedVfsLink(db, { parentId: folderId, childId: itemId });
 * ```
 */
export async function seedVfsLink(
  db: Database,
  options: { parentId: string; childId: string; id?: string }
): Promise<string> {
  const { parentId, childId, id = crypto.randomUUID() } = options;
  const now = new Date();

  await db.insert(vfsLinks).values({
    id,
    parentId,
    childId,
    wrappedSessionKey: 'test-wrapped-key',
    createdAt: now
  });

  return id;
}
