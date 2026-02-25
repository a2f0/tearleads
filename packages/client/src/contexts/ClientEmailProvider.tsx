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
import { and, asc, desc, eq, sql } from 'drizzle-orm';
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
  emails,
  vfsLinks,
  vfsRegistry
} from '@/db/schema';
import { API_BASE_URL } from '@/lib/api';
import { getAuthHeaderValue } from '@/lib/authStorage';

const EMAIL_FOLDER_ICON = 'email-folder';

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

    const folderRows = await db
      .select({
        id: vfsRegistry.id,
        encryptedName: vfsRegistry.encryptedName,
        parentId: vfsLinks.parentId
      })
      .from(vfsRegistry)
      .leftJoin(vfsLinks, eq(vfsRegistry.id, vfsLinks.childId))
      .where(
        and(
          eq(vfsRegistry.objectType, 'folder'),
          eq(vfsRegistry.icon, EMAIL_FOLDER_ICON)
        )
      )
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
            objectType: 'folder',
            ownerId: null,
            encryptedName: name,
            icon: EMAIL_FOLDER_ICON,
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
      const existing = await db
        .select({ id: vfsRegistry.id })
        .from(vfsRegistry)
        .where(
          and(
            eq(vfsRegistry.objectType, 'folder'),
            eq(vfsRegistry.icon, EMAIL_FOLDER_ICON),
            eq(vfsRegistry.encryptedName, folderName)
          )
        );

      if (existing.length === 0) {
        await runLocalWrite(async () => {
          await db.insert(vfsRegistry).values({
            id: crypto.randomUUID(),
            objectType: 'folder',
            ownerId: null,
            encryptedName: folderName,
            icon: EMAIL_FOLDER_ICON,
            createdAt: new Date()
          });
        });
      }
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
            eq(vfsRegistry.objectType, 'folder'),
            eq(vfsRegistry.icon, EMAIL_FOLDER_ICON),
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
