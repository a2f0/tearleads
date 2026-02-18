import {
  type EmailContactOperations,
  type EmailDraftOperations,
  type EmailFolder,
  type EmailFolderOperations,
  type EmailFolderType,
  EmailProvider,
  type EmailUIComponents,
  SYSTEM_FOLDER_NAMES,
  SYSTEM_FOLDER_TYPES
} from '@tearleads/email';
import emailPackageJson from '@tearleads/email/package.json';
import { asc, desc, eq } from 'drizzle-orm';
import { type ReactNode, useCallback, useMemo } from 'react';
import { BackLink } from '@/components/ui/back-link';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { AboutMenuItem } from '@/components/window-menu/AboutMenuItem';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { getDatabase } from '@/db';
import {
  deleteEmailDraftFromDb,
  getEmailDraftFromDb,
  listEmailDraftsFromDb,
  saveEmailDraftToDb
} from '@/db/emailDrafts';
import { useDatabaseContext } from '@/db/hooks';
import { runLocalWrite } from '@/db/localWrite';
import {
  contactEmails,
  contacts,
  emailFolders,
  vfsLinks,
  vfsRegistry
} from '@/db/schema';
import { API_BASE_URL } from '@/lib/api';
import { getAuthHeaderValue } from '@/lib/authStorage';

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

    // Get all email folders with their parent links using LEFT JOIN
    const folderRows = await db
      .select({
        id: emailFolders.id,
        encryptedName: emailFolders.encryptedName,
        folderType: emailFolders.folderType,
        unreadCount: emailFolders.unreadCount,
        parentId: vfsLinks.parentId
      })
      .from(emailFolders)
      .leftJoin(vfsLinks, eq(emailFolders.id, vfsLinks.childId));

    return folderRows.map((row) => ({
      id: row.id,
      name: row.encryptedName ?? 'Unnamed Folder',
      folderType: (row.folderType ?? 'custom') as EmailFolderType,
      parentId: row.parentId ?? null,
      unreadCount: row.unreadCount ?? 0
    }));
  }, []);

  const createFolder = useCallback(
    async (name: string, parentId?: string | null): Promise<EmailFolder> => {
      const db = getDatabase();
      const folderId = crypto.randomUUID();
      const now = new Date();

      // Use transaction for atomicity
      await runLocalWrite(async () =>
        db.transaction(async (tx) => {
          // Create VFS registry entry
          await tx.insert(vfsRegistry).values({
            id: folderId,
            objectType: 'emailFolder',
            ownerId: null,
            createdAt: now
          });

          // Create email folder entry
          await tx.insert(emailFolders).values({
            id: folderId,
            encryptedName: name,
            folderType: 'custom',
            unreadCount: 0
          });

          // If parentId provided, create link
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
          .update(emailFolders)
          .set({ encryptedName: newName })
          .where(eq(emailFolders.id, id));
      });
    },
    []
  );

  const deleteFolder = useCallback(async (id: string): Promise<void> => {
    const db = getDatabase();

    // Use transaction for atomicity
    await runLocalWrite(async () =>
      db.transaction(async (tx) => {
        // Delete any child links (emails in this folder)
        await tx.delete(vfsLinks).where(eq(vfsLinks.parentId, id));

        // Delete the folder's parent link (if nested)
        await tx.delete(vfsLinks).where(eq(vfsLinks.childId, id));

        // Delete email folder entry
        await tx.delete(emailFolders).where(eq(emailFolders.id, id));

        // Delete VFS registry entry
        await tx.delete(vfsRegistry).where(eq(vfsRegistry.id, id));
      })
    );
  }, []);

  const moveFolder = useCallback(
    async (id: string, newParentId: string | null): Promise<void> => {
      const db = getDatabase();

      // Use transaction for atomicity
      await runLocalWrite(async () =>
        db.transaction(async (tx) => {
          // Delete existing parent link
          await tx.delete(vfsLinks).where(eq(vfsLinks.childId, id));

          // If new parent provided, create new link
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

        // Use transaction for atomicity
        await runLocalWrite(async () =>
          db.transaction(async (tx) => {
            // Create VFS registry entry
            await tx.insert(vfsRegistry).values({
              id: folderId,
              objectType: 'emailFolder',
              ownerId: null,
              createdAt: now
            });

            // Create email folder entry
            await tx.insert(emailFolders).values({
              id: folderId,
              encryptedName: folderName,
              folderType,
              unreadCount: 0
            });
          })
        );
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

  const fetchContactEmails = useCallback(async () => {
    const db = getDatabase();

    const rows = await db
      .select({
        contactId: contacts.id,
        firstName: contacts.firstName,
        lastName: contacts.lastName,
        email: contactEmails.email,
        label: contactEmails.label,
        isPrimary: contactEmails.isPrimary
      })
      .from(contacts)
      .innerJoin(contactEmails, eq(contactEmails.contactId, contacts.id))
      .where(eq(contacts.deleted, false))
      .orderBy(
        asc(contacts.firstName),
        asc(contacts.lastName),
        desc(contactEmails.isPrimary),
        asc(contactEmails.email)
      );

    return rows;
  }, []);

  const contactOperations: EmailContactOperations = useMemo(
    () => ({
      fetchContactEmails
    }),
    [fetchContactEmails]
  );

  const saveDraft = useCallback<EmailDraftOperations['saveDraft']>(
    async (input) => {
      const db = getDatabase();
      const draftsFolder = await getFolderByType('drafts');
      return runLocalWrite(
        async () => saveEmailDraftToDb(db, input, draftsFolder?.id),
        { scope: 'email-drafts' }
      );
    },
    [getFolderByType]
  );

  const getDraft = useCallback<EmailDraftOperations['getDraft']>(async (id) => {
    const db = getDatabase();
    return getEmailDraftFromDb(db, id);
  }, []);

  const fetchDrafts = useCallback<
    EmailDraftOperations['fetchDrafts']
  >(async () => {
    const db = getDatabase();
    return listEmailDraftsFromDb(db);
  }, []);

  const deleteDraft = useCallback<EmailDraftOperations['deleteDraft']>(
    async (id) => {
      const db = getDatabase();
      return runLocalWrite(async () => deleteEmailDraftFromDb(db, id), {
        scope: 'email-drafts'
      });
    },
    []
  );

  const draftOperations: EmailDraftOperations = useMemo(
    () => ({
      saveDraft,
      getDraft,
      fetchDrafts,
      deleteDraft
    }),
    [saveDraft, getDraft, fetchDrafts, deleteDraft]
  );

  const providerProps = {
    apiBaseUrl: API_BASE_URL,
    getAuthHeader: getAuthHeaderValue,
    ui: emailUIComponents,
    ...(isUnlocked && { draftOperations }),
    ...(isUnlocked && { contactOperations }),
    ...(isUnlocked && { folderOperations })
  };

  return <EmailProvider {...providerProps}>{children}</EmailProvider>;
}
