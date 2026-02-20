/**
 * Hook for contacts context menu handling.
 */

import { eq } from 'drizzle-orm';
import { useCallback, useState } from 'react';
import { getDatabase } from '@/db';
import { contacts as contactsTable } from '@/db/schema';
import { useContactsExport } from '@/hooks/contacts';
import { useNavigateWithFrom } from '@/lib/navigation';
import type { ContactInfo } from './types';

interface ContextMenuState {
  contact: ContactInfo;
  x: number;
  y: number;
}

interface UseContactsContextMenuResult {
  contextMenu: ContextMenuState | null;
  handleContextMenu: (e: React.MouseEvent, contact: ContactInfo) => void;
  handleGetInfo: () => void;
  handleEdit: () => void;
  handleDelete: () => Promise<void>;
  handleCloseContextMenu: () => void;
  handleExportContact: () => Promise<void>;
}

export function useContactsContextMenu(
  debouncedSearch: string,
  fetchContacts: (search?: string) => Promise<void>,
  setError: (error: string | null) => void
): UseContactsContextMenuResult {
  const navigateWithFrom = useNavigateWithFrom();
  const { exportContact } = useContactsExport();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, contact: ContactInfo) => {
      e.preventDefault();
      setContextMenu({ contact, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      navigateWithFrom(`/contacts/${contextMenu.contact.id}`, {
        fromLabel: 'Back to Contacts'
      });
      setContextMenu(null);
    }
  }, [contextMenu, navigateWithFrom]);

  const handleEdit = useCallback(() => {
    if (contextMenu) {
      navigateWithFrom(`/contacts/${contextMenu.contact.id}`, {
        fromLabel: 'Back to Contacts',
        state: { autoEdit: true }
      });
      setContextMenu(null);
    }
  }, [contextMenu, navigateWithFrom]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(contactsTable)
        .set({ deleted: true, updatedAt: new Date() })
        .where(eq(contactsTable.id, contextMenu.contact.id));

      await fetchContacts(debouncedSearch);
    } catch (err) {
      console.error('Failed to delete contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, fetchContacts, debouncedSearch, setError]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleExportContact = useCallback(async () => {
    if (!contextMenu) return;

    try {
      await exportContact(contextMenu.contact.id);
    } catch (err) {
      console.error('Failed to export contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, exportContact, setError]);

  return {
    contextMenu,
    handleContextMenu,
    handleGetInfo,
    handleEdit,
    handleDelete,
    handleCloseContextMenu,
    handleExportContact
  };
}
