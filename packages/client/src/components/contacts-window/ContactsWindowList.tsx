import { useVirtualizer } from '@tanstack/react-virtual';
import { and, asc, eq } from 'drizzle-orm';
import { Info, Loader2, Mail, Phone, Plus, Trash2, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Input } from '@/components/ui/input';
import { ListRow } from '@/components/ui/list-row';
import { RefreshButton } from '@/components/ui/refresh-button';
import { VirtualListStatus } from '@/components/ui/VirtualListStatus';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import {
  contactEmails,
  contactPhones,
  contacts as contactsTable
} from '@/db/schema';
import { useTypedTranslation } from '@/i18n';

interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
}

const ROW_HEIGHT_ESTIMATE = 56;

interface ContactsWindowListProps {
  onSelectContact: (contactId: string) => void;
  onCreateContact: () => void;
  refreshToken?: number;
}

export function ContactsWindowList({
  onSelectContact,
  onCreateContact,
  refreshToken
}: ContactsWindowListProps) {
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const { t } = useTypedTranslation('contextMenu');
  const [contactsList, setContactsList] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    contact: ContactInfo;
    x: number;
    y: number;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const filteredContacts = contactsList.filter((contact) => {
    const searchLower = searchQuery.toLowerCase();
    const fullName =
      `${contact.firstName} ${contact.lastName ?? ''}`.toLowerCase();
    return (
      fullName.includes(searchLower) ||
      (contact.primaryEmail?.toLowerCase().includes(searchLower) ?? false) ||
      (contact.primaryPhone?.includes(searchQuery) ?? false)
    );
  });

  const virtualizer = useVirtualizer({
    count: filteredContacts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();
  const firstVisible =
    virtualItems.length > 0 ? (virtualItems[0]?.index ?? 0) : 0;
  const lastVisible =
    virtualItems.length > 0
      ? (virtualItems[virtualItems.length - 1]?.index ?? 0)
      : 0;

  const fetchContacts = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const db = getDatabase();

      const result = await db
        .select({
          id: contactsTable.id,
          firstName: contactsTable.firstName,
          lastName: contactsTable.lastName,
          primaryEmail: contactEmails.email,
          primaryPhone: contactPhones.phoneNumber
        })
        .from(contactsTable)
        .leftJoin(
          contactEmails,
          and(
            eq(contactEmails.contactId, contactsTable.id),
            eq(contactEmails.isPrimary, true)
          )
        )
        .leftJoin(
          contactPhones,
          and(
            eq(contactPhones.contactId, contactsTable.id),
            eq(contactPhones.isPrimary, true)
          )
        )
        .where(eq(contactsTable.deleted, false))
        .orderBy(asc(contactsTable.firstName));

      setContactsList(
        result.map((row) => ({
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          primaryEmail: row.primaryEmail,
          primaryPhone: row.primaryPhone
        }))
      );
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  const fetchedForInstanceRef = useRef<string | null>(null);

  useEffect(() => {
    if (refreshToken === undefined) return;
    setHasFetched(false);
    setError(null);
  }, [refreshToken]);

  useEffect(() => {
    const needsFetch =
      isUnlocked &&
      !loading &&
      (!hasFetched || fetchedForInstanceRef.current !== currentInstanceId);

    if (needsFetch) {
      if (
        fetchedForInstanceRef.current !== currentInstanceId &&
        fetchedForInstanceRef.current !== null
      ) {
        setContactsList([]);
        setError(null);
      }

      fetchedForInstanceRef.current = currentInstanceId;

      const timeoutId = setTimeout(() => {
        fetchContacts();
      }, 0);

      return () => clearTimeout(timeoutId);
    }
    return undefined;
  }, [
    isUnlocked,
    loading,
    hasFetched,
    currentInstanceId,
    fetchContacts,
    refreshToken
  ]);

  const handleContactClick = useCallback(
    (contact: ContactInfo) => {
      onSelectContact(contact.id);
    },
    [onSelectContact]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, contact: ContactInfo) => {
      e.preventDefault();
      setContextMenu({ contact, x: e.clientX, y: e.clientY });
    },
    []
  );

  const handleGetInfo = useCallback(() => {
    if (contextMenu) {
      onSelectContact(contextMenu.contact.id);
      setContextMenu(null);
    }
  }, [contextMenu, onSelectContact]);

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(contactsTable)
        .set({ deleted: true, updatedAt: new Date() })
        .where(eq(contactsTable.id, contextMenu.contact.id));

      setHasFetched(false);
    } catch (err) {
      console.error('Failed to delete contact:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const getDisplayName = (contact: ContactInfo) => {
    return `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`;
  };

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <User className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Contacts</h2>
        </div>
        {isUnlocked && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onCreateContact}
              className="h-7 px-2"
              data-testid="window-create-contact-button"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <RefreshButton
              onClick={fetchContacts}
              loading={loading}
              size="sm"
            />
          </div>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="contacts" />}

      {error && (
        <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
          {error}
        </div>
      )}

      {isUnlocked &&
        !error &&
        (loading && !hasFetched ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading contacts...
          </div>
        ) : contactsList.length === 0 && hasFetched ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center">
            <User className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">No contacts yet</p>
              <p className="text-muted-foreground text-xs">
                Create your first contact
              </p>
            </div>
            <Button
              size="sm"
              onClick={onCreateContact}
              data-testid="window-empty-create-contact"
            >
              <Plus className="mr-1 h-3 w-3" />
              Create
            </Button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col space-y-2">
            <Input
              type="search"
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 text-sm"
              data-testid="window-contacts-search"
            />
            <VirtualListStatus
              firstVisible={firstVisible}
              lastVisible={lastVisible}
              loadedCount={filteredContacts.length}
              itemLabel="contact"
            />
            <div className="flex-1 rounded-lg border">
              <div ref={parentRef} className="h-full overflow-auto">
                <div
                  className="relative w-full"
                  style={{ height: `${virtualizer.getTotalSize()}px` }}
                >
                  {virtualItems.map((virtualItem) => {
                    const contact = filteredContacts[virtualItem.index];
                    if (!contact) return null;

                    return (
                      <div
                        key={contact.id}
                        data-index={virtualItem.index}
                        ref={virtualizer.measureElement}
                        className="absolute top-0 left-0 w-full px-1 py-0.5"
                        style={{
                          transform: `translateY(${virtualItem.start}px)`
                        }}
                      >
                        <ListRow
                          onContextMenu={(e) => handleContextMenu(e, contact)}
                        >
                          <button
                            type="button"
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 overflow-hidden text-left"
                            onClick={() => handleContactClick(contact)}
                          >
                            <User className="h-4 w-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-medium text-xs">
                                {getDisplayName(contact)}
                              </p>
                              <p className="flex items-center gap-2 truncate text-muted-foreground text-xs">
                                {contact.primaryEmail && (
                                  <span className="flex items-center gap-0.5">
                                    <Mail className="h-3 w-3" />
                                    {contact.primaryEmail}
                                  </span>
                                )}
                                {contact.primaryPhone && (
                                  <span className="flex items-center gap-0.5">
                                    <Phone className="h-3 w-3" />
                                    {contact.primaryPhone}
                                  </span>
                                )}
                                {!contact.primaryEmail &&
                                  !contact.primaryPhone &&
                                  'No contact info'}
                              </p>
                            </div>
                          </button>
                        </ListRow>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ))}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={handleCloseContextMenu}
        >
          <ContextMenuItem
            icon={<Info className="h-4 w-4" />}
            onClick={handleGetInfo}
          >
            {t('getInfo')}
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleDelete}
          >
            {t('delete')}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
