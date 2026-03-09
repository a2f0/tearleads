import { notes, tags, vfsLinks, vfsRegistry } from '@tearleads/db/sqlite';
import {
  classicTestMigrations,
  withRealDatabase
} from '@tearleads/db-test-utils';
import type {
  VfsLinkLikeRow,
  VfsNoteLikeRow,
  VfsRegistryLikeRow,
  VfsTagLikeRow
} from '../lib/types';

// Classic uses a dedicated folder as the parent for all tags.
export const CLASSIC_ROOT_ID = '11111111-1111-1111-1111-111111111111';

type WithRealDatabaseCallback = Parameters<typeof withRealDatabase>[0];
type TestDb = Parameters<WithRealDatabaseCallback>[0]['db'];

export async function withClassicRealDatabase(
  callback: WithRealDatabaseCallback
): Promise<void> {
  await withRealDatabase(callback, { migrations: classicTestMigrations });
}

export async function seedClassicRoot(db: TestDb, now: Date): Promise<void> {
  await db.insert(vfsRegistry).values({
    id: CLASSIC_ROOT_ID,
    objectType: 'folder',
    ownerId: null,
    encryptedName: 'Classic',
    createdAt: now
  });
}

export async function seedTag(
  db: TestDb,
  options: {
    id: string;
    name: string;
    deleted?: boolean;
    position?: number;
    now: Date;
  }
): Promise<string> {
  const { id, name, deleted = false, position, now } = options;

  await db.insert(vfsRegistry).values({
    id,
    objectType: 'tag',
    ownerId: null,
    createdAt: now
  });

  await db.insert(tags).values({
    id,
    encryptedName: name,
    deleted
  });

  const linkId = crypto.randomUUID();
  await db.insert(vfsLinks).values({
    id: linkId,
    parentId: CLASSIC_ROOT_ID,
    childId: id,
    wrappedSessionKey: 'test-key',
    position: position ?? null,
    createdAt: now
  });

  return id;
}

export async function seedNote(
  db: TestDb,
  options: {
    id: string;
    title: string;
    content?: string;
    tagId: string;
    position?: number;
    now: Date;
  }
): Promise<string> {
  const { id, title, content = '', tagId, position, now } = options;

  await db.insert(vfsRegistry).values({
    id,
    objectType: 'note',
    ownerId: null,
    createdAt: now
  });

  await db.insert(notes).values({
    id,
    title,
    content,
    createdAt: now,
    updatedAt: now
  });

  const linkId = crypto.randomUUID();
  await db.insert(vfsLinks).values({
    id: linkId,
    parentId: tagId,
    childId: id,
    wrappedSessionKey: 'test-key',
    position: position ?? null,
    createdAt: now
  });

  return id;
}

export async function queryClassicData(db: TestDb): Promise<{
  registryRows: VfsRegistryLikeRow[];
  tagRows: VfsTagLikeRow[];
  noteRows: VfsNoteLikeRow[];
  linkRows: VfsLinkLikeRow[];
}> {
  const registryRows = await db
    .select({
      id: vfsRegistry.id,
      objectType: vfsRegistry.objectType,
      createdAt: vfsRegistry.createdAt
    })
    .from(vfsRegistry);

  const tagRows = await db
    .select({
      id: tags.id,
      encryptedName: tags.encryptedName,
      deleted: tags.deleted
    })
    .from(tags);

  const noteRows = await db
    .select({
      id: notes.id,
      title: notes.title,
      content: notes.content,
      createdAt: notes.createdAt,
      updatedAt: notes.updatedAt
    })
    .from(notes);

  const linkRows = await db
    .select({
      parentId: vfsLinks.parentId,
      childId: vfsLinks.childId,
      position: vfsLinks.position,
      createdAt: vfsLinks.createdAt
    })
    .from(vfsLinks);

  return {
    registryRows,
    tagRows,
    noteRows,
    linkRows
  };
}
