import { useVirtualizer } from '@tanstack/react-virtual';
import { contacts as contactsTable } from '@tearleads/db/sqlite';
import { eq } from 'drizzle-orm';
import { Loader2, Mail, Phone, Plus, User } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useContactsContext, useContactsUI } from '../context';
import { type ContactInfo, useContacts } from '../hooks/useContacts';
import { setContactDragData } from '../lib/contactDragData';
import { openComposeEmail } from '../lib/contactEmail';
import { ContactsListContextMenus } from './ContactsListContextMenus';
import { ContactsListHeader } from './ContactsListHeader';

const ROW_HEIGHT_ESTIMATE = 56;

interface ContactsWindowListProps {
  onSelectContact: (contactId: string) => void;
  onCreateContact: () => void;
  refreshToken?: number;
  groupId?: string | undefined;
}

export function ContactsWindowList({
  onSelectContact,
  onCreateContact,
  refreshToken,
  groupId
}: ContactsWindowListProps) {
  const { databaseState, getDatabase, t, openEmailComposer } =
    useContactsContext();
  const { isUnlocked, isLoading } = databaseState;
  const {
    Button,
    Input,
    ContextMenu,
    ContextMenuItem,
    ListRow,
    RefreshButton,
    VirtualListStatus,
    InlineUnlock
  } = useContactsUI();

  const {
    contactsList,
    loading,
    error,
    hasFetched,
    fetchContacts,
    setHasFetched
  } = useContacts({ refreshToken, groupId });
  const [searchQuery, setSearchQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    contact: ContactInfo;
    x: number;
    y: number;
  } | null>(null);
  const [emptySpaceContextMenu, setEmptySpaceContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusTimer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 50);

    return () => window.clearTimeout(focusTimer);
  }, []);

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

  const handleContactClick = useCallback(
    (contact: ContactInfo) => {
      onSelectContact(contact.id);
    },
    [onSelectContact]
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, contact: ContactInfo) => {
      e.preventDefault();
      e.stopPropagation();
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
    } finally {
      setContextMenu(null);
    }
  }, [contextMenu, setHasFetched, getDatabase]);

  const handleSendEmail = useCallback(() => {
    const primaryEmail = contextMenu?.contact.primaryEmail;
    if (!primaryEmail) return;

    openComposeEmail([primaryEmail], openEmailComposer);
    setContextMenu(null);
  }, [contextMenu, openEmailComposer]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleEmptySpaceContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setEmptySpaceContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const clearEmptySpaceContextMenu = useCallback(() => {
    setEmptySpaceContextMenu(null);
  }, []);

  const handleNewContactFromEmptySpace = useCallback(() => {
    onCreateContact();
    setEmptySpaceContextMenu(null);
  }, [onCreateContact]);

  const getDisplayName = (contact: ContactInfo) => {
    return `${contact.firstName}${contact.lastName ? ` ${contact.lastName}` : ''}`;
  };

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <ContactsListHeader isUnlocked={isUnlocked}>
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
          <RefreshButton onClick={fetchContacts} loading={loading} size="sm" />
        </div>
      </ContactsListHeader>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          {t('loadingDatabase')}
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <InlineUnlock description={t('contacts')} />
      )}

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
            {t('loadingContacts')}
          </div>
        ) : contactsList.length === 0 && hasFetched ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space
          <div
            className="flex flex-col items-center justify-center gap-2 rounded-lg border p-6 text-center"
            onContextMenu={handleEmptySpaceContextMenu}
          >
            <User className="h-8 w-8 text-muted-foreground" />
            <div>
              <p className="font-medium text-sm">{t('noContactsYet')}</p>
              <p className="text-muted-foreground text-xs">
                {t('createFirstContact')}
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
          <div className="flex min-h-0 flex-1 flex-col">
            {/* biome-ignore lint/a11y/noStaticElementInteractions: Context menu on empty space */}
            <div
              ref={parentRef}
              className="flex-1 overflow-auto rounded-lg border"
              data-testid="contacts-scroll-container"
              onContextMenu={handleEmptySpaceContextMenu}
            >
              {/* Sticky section - search and status line */}
              <div className="sticky top-0 z-10 space-y-2 bg-background p-2">
                <Input
                  type="search"
                  placeholder={t('searchContacts')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  inputRef={searchInputRef}
                  className="h-8 text-base"
                  data-testid="window-contacts-search"
                />
                <VirtualListStatus
                  firstVisible={firstVisible}
                  lastVisible={lastVisible}
                  loadedCount={filteredContacts.length}
                  itemLabel="contact"
                />
              </div>
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
                          draggable
                          onDragStart={(event) =>
                            setContactDragData(event, [contact.id])
                          }
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
                                t('noContactInfo')}
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
        ))}

      <ContactsListContextMenus
        contextMenu={contextMenu}
        emptySpaceContextMenu={emptySpaceContextMenu}
        onCloseContextMenu={handleCloseContextMenu}
        onCloseEmptySpaceMenu={clearEmptySpaceContextMenu}
        onSendEmail={handleSendEmail}
        onGetInfo={handleGetInfo}
        onDelete={() => {
          void handleDelete();
        }}
        onNewContact={handleNewContactFromEmptySpace}
        labels={{ getInfo: t('getInfo'), delete: t('delete') }}
        ContextMenu={ContextMenu}
        ContextMenuItem={ContextMenuItem}
      />
    </div>
  );
}
