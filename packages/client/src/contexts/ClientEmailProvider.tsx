import {
  type EmailFolder,
  type EmailFolderOperations,
  type EmailFolderType,
  EmailProvider,
  type EmailUIComponents,
  SYSTEM_FOLDER_NAMES,
  SYSTEM_FOLDER_TYPES
} from '@rapid/email';
import emailPackageJson from '@rapid/email/package.json';
import { eq } from 'drizzle-orm';
import { type ReactNode, useCallback, useMemo } from 'react';
import { BackLink } from '@/components/ui/back-link';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { RefreshButton } from '@/components/ui/refresh-button';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import { emailFolders, vfsLinks, vfsRegistry } from '@/db/schema';
import { API_BASE_URL } from '@/lib/api';
import { getAuthHeaderValue } from '@/lib/auth-storage';

export function EmailAboutMenuItem() {
  return <AboutMenuItem appName="Email" version={emailPackageJson.version} />;
}

const emailUIComponents: EmailUIComponents = {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator,
  WindowOptionsMenuItem,
  AboutMenuItem: EmailAboutMenuItem,
  BackLink,
  RefreshButton
};

interface ClientEmailProviderProps {
  children: ReactNode;
}

export function ClientEmailProvider({ children }: ClientEmailProviderProps) {
  const { isUnlocked } = useDatabaseContext();

  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const fetchFolders = useCallback(async (): Promise<EmailFolder[]> => {
    const db = getDatabase();

    // Get all email folders with their parent links
    const folderRows = await db
      .select({
        id: emailFolders.id,
        encryptedName: emailFolders.encryptedName,
        folderType: emailFolders.folderType,
        unreadCount: emailFolders.unreadCount
      })
      .from(emailFolders);

    // Get parent links for folders
    const links = await db
      .select({
        childId: vfsLinks.childId,
        parentId: vfsLinks.parentId
      })
      .from(vfsLinks)
      .innerJoin(emailFolders, eq(emailFolders.id, vfsLinks.childId));

    const parentMap = new Map<string, string>();
    for (const link of links) {
      parentMap.set(link.childId, link.parentId);
    }

    return folderRows.map((row) => ({
      id: row.id,
      name: row.encryptedName ?? 'Unnamed Folder',
      folderType: (row.folderType ?? 'custom') as EmailFolderType,
      parentId: parentMap.get(row.id) ?? null,
      unreadCount: row.unreadCount ?? 0
    }));
  }, []);

  const createFolder = useCallback(
    async (name: string, parentId?: string | null): Promise<EmailFolder> => {
      const db = getDatabase();
      const folderId = crypto.randomUUID();
      const now = new Date();

      // Create VFS registry entry
      await db.insert(vfsRegistry).values({
        id: folderId,
        objectType: 'emailFolder',
        ownerId: null,
        createdAt: now
      });

      // Create email folder entry
      await db.insert(emailFolders).values({
        id: folderId,
        encryptedName: name,
        folderType: 'custom',
        unreadCount: 0
      });

      // If parentId provided, create link
      if (parentId) {
        const linkId = crypto.randomUUID();
        await db.insert(vfsLinks).values({
          id: linkId,
          parentId,
          childId: folderId,
          wrappedSessionKey: '',
          createdAt: now
        });
      }

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
      await db
        .update(emailFolders)
        .set({ encryptedName: newName })
        .where(eq(emailFolders.id, id));
    },
    []
  );

  const deleteFolder = useCallback(async (id: string): Promise<void> => {
    const db = getDatabase();

    // Delete any child links (emails in this folder)
    await db.delete(vfsLinks).where(eq(vfsLinks.parentId, id));

    // Delete the folder's parent link (if nested)
    await db.delete(vfsLinks).where(eq(vfsLinks.childId, id));

    // Delete email folder entry
    await db.delete(emailFolders).where(eq(emailFolders.id, id));

    // Delete VFS registry entry
    await db.delete(vfsRegistry).where(eq(vfsRegistry.id, id));
  }, []);

  const moveFolder = useCallback(
    async (id: string, newParentId: string | null): Promise<void> => {
      const db = getDatabase();

      // Delete existing parent link
      await db.delete(vfsLinks).where(eq(vfsLinks.childId, id));

      // If new parent provided, create new link
      if (newParentId) {
        const linkId = crypto.randomUUID();
        await db.insert(vfsLinks).values({
          id: linkId,
          parentId: newParentId,
          childId: id,
          wrappedSessionKey: '',
          createdAt: new Date()
        });
      }
    },
    []
  );

  const initializeSystemFolders = useCallback(async (): Promise<void> => {
    const db = getDatabase();

    for (const folderType of SYSTEM_FOLDER_TYPES) {
      // Check if folder already exists
      const existing = await db
        .select({ id: emailFolders.id })
        .from(emailFolders)
        .where(eq(emailFolders.folderType, folderType));

      if (existing.length === 0) {
        const folderId = crypto.randomUUID();
        const now = new Date();
        const folderName =
          SYSTEM_FOLDER_NAMES[folderType as keyof typeof SYSTEM_FOLDER_NAMES];

        // Create VFS registry entry
        await db.insert(vfsRegistry).values({
          id: folderId,
          objectType: 'emailFolder',
          ownerId: null,
          createdAt: now
        });

        // Create email folder entry
        await db.insert(emailFolders).values({
          id: folderId,
          encryptedName: folderName,
          folderType,
          unreadCount: 0
        });
      }
    }
  }, []);

  const getFolderByType = useCallback(
    async (type: EmailFolderType): Promise<EmailFolder | null> => {
      const db = getDatabase();

      const result = await db
        .select({
          id: emailFolders.id,
          encryptedName: emailFolders.encryptedName,
          folderType: emailFolders.folderType,
          unreadCount: emailFolders.unreadCount
        })
        .from(emailFolders)
        .where(eq(emailFolders.folderType, type));

      if (result.length === 0) return null;

      const row = result[0];
      if (!row) return null;

      return {
        id: row.id,
        name: row.encryptedName ?? 'Unnamed Folder',
        folderType: (row.folderType ?? 'custom') as EmailFolderType,
        parentId: null, // System folders don't have parents
        unreadCount: row.unreadCount ?? 0
      };
    },
    []
  );

  const folderOperations: EmailFolderOperations = useMemo(
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

  const providerProps = {
    apiBaseUrl: API_BASE_URL,
    getAuthHeader: getAuthHeaderValue,
    ui: emailUIComponents,
    ...(isUnlocked && { folderOperations })
  };

  return <EmailProvider {...providerProps}>{children}</EmailProvider>;
}
