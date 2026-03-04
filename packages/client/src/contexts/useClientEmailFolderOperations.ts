import type {
  EmailFolder,
  EmailFolderOperations,
  EmailFolderType
} from '@tearleads/email';
import { SYSTEM_FOLDER_NAMES, SYSTEM_FOLDER_TYPES } from '@tearleads/email';
import { and, asc, eq, sql } from 'drizzle-orm';
import { useCallback, useMemo } from 'react';
import { getDatabase } from '@/db';
import { runLocalWrite } from '@/db/localWrite';
import { emails, vfsLinks, vfsRegistry } from '@/db/schema';

function deriveFolderType(name: string | null): EmailFolderType {
  const normalized = (name ?? '').trim().toLowerCase();
  switch (normalized) {
    case 'inbox':
      return 'inbox';
    case 'sent':
      return 'sent';
    case 'drafts':
      return 'drafts';
    case 'trash':
      return 'trash';
    case 'spam':
      return 'spam';
    default:
      return 'custom';
  }
}

function systemFolderName(type: EmailFolderType): string {
  return SYSTEM_FOLDER_NAMES[type as keyof typeof SYSTEM_FOLDER_NAMES] ?? type;
}

export function useClientEmailFolderOperations(): EmailFolderOperations & {
  getFolderByType: (type: EmailFolderType) => Promise<EmailFolder | null>;
} {
  const fetchFolders = useCallback(async (): Promise<EmailFolder[]> => {
    const db = getDatabase();

    const folderRows = await db
      .select({
        id: vfsRegistry.id,
        encryptedName: vfsRegistry.encryptedName,
        parentId: vfsLinks.parentId
      })
      .from(vfsRegistry)
      .leftJoin(vfsLinks, eq(vfsRegistry.id, vfsLinks.childId))
      .where(eq(vfsRegistry.objectType, 'emailFolder'))
      .orderBy(asc(vfsRegistry.encryptedName));

    const unreadRows = await db
      .select({
        parentId: vfsLinks.parentId,
        unreadCount: sql<number>`cast(count(*) as integer)`
      })
      .from(vfsLinks)
      .innerJoin(emails, eq(vfsLinks.childId, emails.id))
      .where(eq(emails.isRead, false))
      .groupBy(vfsLinks.parentId);

    const unreadByFolderId = new Map(
      unreadRows.map((row) => [row.parentId, row.unreadCount ?? 0])
    );

    return folderRows.map((row) => ({
      id: row.id,
      name: row.encryptedName ?? 'Unnamed Folder',
      folderType: deriveFolderType(row.encryptedName),
      parentId: row.parentId ?? null,
      unreadCount: unreadByFolderId.get(row.id) ?? 0
    }));
  }, []);

  const createFolder = useCallback(
    async (name: string, parentId?: string | null): Promise<EmailFolder> => {
      const db = getDatabase();
      const folderId = crypto.randomUUID();
      const now = new Date();

      await runLocalWrite(async () =>
        db.transaction(async (tx) => {
          await tx.insert(vfsRegistry).values({
            id: folderId,
            objectType: 'emailFolder',
            ownerId: null,
            encryptedName: name,
            createdAt: now
          });

          if (parentId) {
            const linkId = crypto.randomUUID();
            await tx.insert(vfsLinks).values({
              id: linkId,
              parentId,
              childId: folderId,
              wrappedSessionKey: '',
              createdAt: now
            });
          }
        })
      );

      return {
        id: folderId,
        name,
        folderType: 'custom',
        parentId: parentId ?? null,
        unreadCount: 0
      };
    },
    []
  );

  const renameFolder = useCallback(
    async (id: string, newName: string): Promise<void> => {
      const db = getDatabase();
      await runLocalWrite(async () => {
        await db
          .update(vfsRegistry)
          .set({ encryptedName: newName })
          .where(eq(vfsRegistry.id, id));
      });
    },
    []
  );

  const deleteFolder = useCallback(async (id: string): Promise<void> => {
    const db = getDatabase();

    await runLocalWrite(async () =>
      db.transaction(async (tx) => {
        await tx.delete(vfsLinks).where(eq(vfsLinks.parentId, id));
        await tx.delete(vfsLinks).where(eq(vfsLinks.childId, id));
        await tx.delete(vfsRegistry).where(eq(vfsRegistry.id, id));
      })
    );
  }, []);

  const moveFolder = useCallback(
    async (id: string, newParentId: string | null): Promise<void> => {
      const db = getDatabase();

      await runLocalWrite(async () =>
        db.transaction(async (tx) => {
          await tx.delete(vfsLinks).where(eq(vfsLinks.childId, id));

          if (newParentId) {
            const linkId = crypto.randomUUID();
            await tx.insert(vfsLinks).values({
              id: linkId,
              parentId: newParentId,
              childId: id,
              wrappedSessionKey: '',
              createdAt: new Date()
            });
          }
        })
      );
    },
    []
  );

  const initializeSystemFolders = useCallback(async (): Promise<void> => {
    const db = getDatabase();

    for (const folderType of SYSTEM_FOLDER_TYPES) {
      const folderName = systemFolderName(folderType);

      await runLocalWrite(async () => {
        await db.transaction(async (tx) => {
          const existing = await tx
            .select({ id: vfsRegistry.id })
            .from(vfsRegistry)
            .where(
              and(
                eq(vfsRegistry.objectType, 'emailFolder'),
                eq(vfsRegistry.encryptedName, folderName)
              )
            );

          if (existing.length === 0) {
            await tx.insert(vfsRegistry).values({
              id: crypto.randomUUID(),
              objectType: 'emailFolder',
              ownerId: null,
              encryptedName: folderName,
              createdAt: new Date()
            });
          }
        });
      });
    }
  }, []);

  const getFolderByType = useCallback(
    async (type: EmailFolderType): Promise<EmailFolder | null> => {
      const db = getDatabase();
      const folderName = systemFolderName(type);

      const result = await db
        .select({
          id: vfsRegistry.id,
          encryptedName: vfsRegistry.encryptedName
        })
        .from(vfsRegistry)
        .where(
          and(
            eq(vfsRegistry.objectType, 'emailFolder'),
            eq(vfsRegistry.encryptedName, folderName)
          )
        );

      if (result.length === 0) return null;

      const row = result[0];
      if (!row) return null;

      return {
        id: row.id,
        name: row.encryptedName ?? 'Unnamed Folder',
        folderType: deriveFolderType(row.encryptedName),
        parentId: null,
        unreadCount: 0
      };
    },
    []
  );

  return useMemo(
    () => ({
      fetchFolders,
      createFolder,
      renameFolder,
      deleteFolder,
      moveFolder,
      initializeSystemFolders,
      getFolderByType
    }),
    [
      fetchFolders,
      createFolder,
      renameFolder,
      deleteFolder,
      moveFolder,
      initializeSystemFolders,
      getFolderByType
    ]
  );
}
