import {
  EmailAboutMenuItem,
  type EmailContactOperations,
  type EmailDraftOperations,
  EmailProvider,
  type EmailUIComponents
} from '@tearleads/app-email';
import { asc, desc, eq } from 'drizzle-orm';
import { type ReactNode, useCallback, useMemo } from 'react';
import { BackLink } from '@/components/ui/back-link';
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { RefreshButton } from '@/components/ui/RefreshButton';
import { WindowOptionsMenuItem } from '@/components/window-menu/WindowOptionsMenuItem';
import { getDatabase } from '@/db';
import {
  deleteEmailDraftFromDb,
  getEmailDraftFromDb,
  listEmailDraftsFromDb,
  saveEmailDraftToDb
} from '@/db/emailDrafts';
import { useHostRuntimeDatabaseState } from '@/db/hooks';
import { runLocalWrite } from '@/db/localWrite';
import { contactEmails, contacts } from '@/db/schema';
import { API_BASE_URL } from '@/lib/api';
import { getAuthHeaderValue } from '@/lib/authStorage';
import { useClientEmailBodyOperations } from './useClientEmailBodyOperations';
import { useClientEmailFolderOperations } from './useClientEmailFolderOperations';

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
  const databaseState = useHostRuntimeDatabaseState();

  if (!API_BASE_URL) {
    throw new Error('VITE_API_URL environment variable is not set');
  }

  const folderOps = useClientEmailFolderOperations();

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
      const draftsFolder = await folderOps.getFolderByType('drafts');
      return runLocalWrite(
        async () => saveEmailDraftToDb(db, input, draftsFolder?.id),
        { scope: 'email-drafts' }
      );
    },
    [folderOps]
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

  const bodyOperations = useClientEmailBodyOperations();

  const providerProps = {
    apiBaseUrl: API_BASE_URL,
    databaseState,
    getAuthHeader: getAuthHeaderValue,
    ui: emailUIComponents,
    ...(databaseState.isUnlocked && { draftOperations }),
    ...(databaseState.isUnlocked && { contactOperations }),
    ...(databaseState.isUnlocked && { folderOperations: folderOps }),
    ...(databaseState.isUnlocked && { bodyOperations })
  };

  return <EmailProvider {...providerProps}>{children}</EmailProvider>;
}
