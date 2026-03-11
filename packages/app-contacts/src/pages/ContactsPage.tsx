// component-complexity: allow – page component consolidating contacts list view
import { useVirtualizer } from '@tanstack/react-virtual';
import { WindowSidebar } from '@tearleads/window-manager';
import {
  Download,
  Info,
  Loader2,
  Mail,
  Menu,
  Pencil,
  Phone,
  Plus,
  Search,
  Trash2,
  Upload,
  User,
  X
} from 'lucide-react';
import { useCallback, useRef, useState } from 'react';
import { ContactsGroupsSidebar } from '../components/ContactsGroupsSidebar';
import { ColumnMapper } from '../components/column-mapper';
import { useContactsContext, useContactsUI } from '../context';
import {
  ROW_HEIGHT_ESTIMATE,
  useContactsContextMenu,
  useContactsImportUI,
  useContactsPageData
} from '../hooks';
import { ALL_CONTACTS_ID } from '../lib/constants';

interface ContactsPageProps {
  groupId?: string | undefined;
}

export function ContactsPage({ groupId: routeGroupId }: ContactsPageProps) {
  const { databaseState, navigate, navigateWithFrom, t } = useContactsContext();
  const { isUnlocked, isLoading } = databaseState;
  const {
    Input,
    RefreshButton,
    VirtualListStatus,
    InlineUnlock,
    Dropzone,
    BackLink
  } = useContactsUI();
  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const parentRef = useRef<HTMLDivElement>(null);

  const {
    contacts,
    loading,
    error,
    setError,
    hasFetched,
    setHasFetched,
    searchQuery,
    setSearchQuery,
    debouncedSearch,
    selectedGroupId,
    fetchContacts,
    searchInputRef
  } = useContactsPageData(routeGroupId, false);

  const {
    parsedData,
    importResult,
    importing,
    progress,
    handleFilesSelected,
    handleImport,
    handleCancelMapping
  } = useContactsImportUI(isUnlocked, setError, () => fetchContacts());

  const {
    contextMenu,
    handleContextMenu,
    handleGetInfo,
    handleEdit,
    handleDelete,
    handleCloseContextMenu,
    handleExportContact
  } = useContactsContextMenu(debouncedSearch, fetchContacts, setError);

  const virtualizer = useVirtualizer({
    count: contacts.length,
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

  const { ContextMenu, ContextMenuItem } = useContactsUI();

  const handleGroupSelect = useCallback(
    (newGroupId: string | null) => {
      const resolvedGroupId = newGroupId ?? ALL_CONTACTS_ID;
      const currentGroupId = routeGroupId ?? ALL_CONTACTS_ID;

      if (resolvedGroupId === currentGroupId) return;

      if (resolvedGroupId === ALL_CONTACTS_ID) {
        navigate('/contacts');
        return;
      }

      navigate(`/contacts/groups/${resolvedGroupId}`);
    },
    [navigate, routeGroupId]
  );

  const handleGroupChanged = useCallback(() => {
    setHasFetched(false);
  }, [setHasFetched]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          type="button"
          className="rounded p-1 hover:bg-accent md:hidden"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open contact groups sidebar"
          data-testid="contacts-sidebar-toggle"
        >
          <Menu className="h-5 w-5" />
        </button>
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
      </div>
      <div className="flex min-h-0 flex-1">
        {isUnlocked && (
          <WindowSidebar
            width={sidebarWidth}
            onWidthChange={setSidebarWidth}
            open={sidebarOpen}
            onOpenChange={setSidebarOpen}
            ariaLabel="Contact groups"
            data-testid="contacts-groups-sidebar"
          >
            <ContactsGroupsSidebar
              selectedGroupId={selectedGroupId}
              onGroupSelect={handleGroupSelect}
              onGroupChanged={handleGroupChanged}
            />
          </WindowSidebar>
        )}
        <div className="flex min-h-0 flex-1 flex-col space-y-6 px-6 pb-6">
          <div className="space-y-2">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <User className="h-8 w-8 text-muted-foreground" />
                <h1 className="font-bold text-2xl tracking-tight">
                  {t('contacts')}
                </h1>
              </div>
              {isUnlocked &&
                !parsedData &&
                (contacts.length > 0 || searchQuery || !hasFetched) && (
                  <div className="flex items-center gap-2">
                    <div className="relative min-w-0 flex-1 sm:flex-initial">
                      <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        inputRef={searchInputRef}
                        type="text"
                        placeholder={t('searchContacts')}
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="h-9 w-full pr-10 pl-9 text-base sm:w-48"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          aria-label="Clear search"
                          onClick={() => setSearchQuery('')}
                          className="absolute top-1/2 right-1 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      )}
                    </div>
                    <RefreshButton
                      onClick={() => fetchContacts(debouncedSearch)}
                      loading={loading}
                    />
                  </div>
                )}
            </div>
          </div>

          {isLoading && (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              {t('loadingDatabase')}
            </div>
          )}

          {!isLoading && !isUnlocked && <InlineUnlock description="contacts" />}

          {isUnlocked && parsedData && (
            <div className="rounded-lg border p-4">
              <div className="mb-4 flex items-center gap-2">
                <Upload className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-semibold">{t('mapCsvColumns')}</h2>
              </div>
              <ColumnMapper
                data={parsedData}
                onImport={handleImport}
                onCancel={handleCancelMapping}
                importing={importing}
              />
              {importing && (
                <div className="mt-4">
                  <div className="mb-1 flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {t('importing')} {progress}%
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {isUnlocked && !parsedData && (
            <>
              <div className="rounded-lg border p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Upload className="h-5 w-5 text-muted-foreground" />
                  <h2 className="font-semibold">{t('importCsv')}</h2>
                </div>
                <Dropzone
                  onFilesSelected={handleFilesSelected}
                  accept=".csv"
                  multiple={false}
                  disabled={importing}
                />
                {importResult && (
                  <div className="mt-3 rounded-md bg-muted p-3 text-sm">
                    <p>
                      {t('imported')} {importResult.imported} contact
                      {importResult.imported !== 1 ? 's' : ''}
                      {importResult.skipped > 0 &&
                        `, ${t('skipped')} ${importResult.skipped}`}
                    </p>
                    {importResult.errors.length > 0 && (
                      <ul className="mt-2 list-inside list-disc text-destructive">
                        {importResult.errors.slice(0, 5).map((err) => (
                          <li key={err}>{err}</li>
                        ))}
                        {importResult.errors.length > 5 && (
                          <li>
                            ...{t('andMore')} {importResult.errors.length - 5}
                          </li>
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {error && (
                <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
                  {error}
                </div>
              )}

              {!loading &&
                contacts.length === 0 &&
                hasFetched &&
                !searchQuery && (
                  <button
                    type="button"
                    onClick={() => navigate('/contacts/new')}
                    className="flex w-full items-center justify-center gap-4 rounded-lg border-2 border-dashed p-8 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                    data-testid="add-contact-card"
                  >
                    <User className="h-8 w-8" />
                    <span className="font-medium">{t('addNewContact')}</span>
                    <Plus className="h-6 w-6" />
                  </button>
                )}

              {!loading &&
                contacts.length === 0 &&
                hasFetched &&
                searchQuery && (
                  <div className="rounded-lg border p-8 text-center text-muted-foreground">
                    {t('noContactsFound')}
                  </div>
                )}

              {contacts.length > 0 && (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div
                    ref={parentRef}
                    className="flex-1 overflow-auto rounded-lg border"
                    data-testid="contacts-scroll-container"
                  >
                    <div
                      className="sticky top-0 z-10 bg-background p-2"
                      data-testid="contacts-sticky-header"
                    >
                      <div data-testid="virtual-list-status">
                        <VirtualListStatus
                          firstVisible={firstVisible}
                          lastVisible={lastVisible}
                          loadedCount={contacts.length}
                          itemLabel="contact"
                          searchQuery={searchQuery}
                        />
                      </div>
                    </div>
                    <div
                      className="relative w-full"
                      style={{ height: `${virtualizer.getTotalSize()}px` }}
                    >
                      {virtualItems.map((virtualItem) => {
                        const contact = contacts[virtualItem.index];
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
                            <button
                              type="button"
                              className="flex w-full items-center justify-between rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
                              onClick={() =>
                                navigateWithFrom(`/contacts/${contact.id}`, {
                                  fromLabel: t('backToContacts')
                                })
                              }
                              onContextMenu={(e) =>
                                handleContextMenu(e, contact)
                              }
                            >
                              <div className="min-w-0 flex-1">
                                <p className="truncate font-medium">
                                  {contact.firstName}
                                  {contact.lastName && ` ${contact.lastName}`}
                                </p>
                                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-sm">
                                  {contact.primaryEmail && (
                                    <span className="flex items-center gap-1">
                                      <Mail className="h-3 w-3" />
                                      <span className="truncate">
                                        {contact.primaryEmail}
                                      </span>
                                    </span>
                                  )}
                                  {contact.primaryPhone && (
                                    <span className="flex items-center gap-1">
                                      <Phone className="h-3 w-3" />
                                      {contact.primaryPhone}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => navigate('/contacts/new')}
                    className="flex w-full items-center justify-center gap-4 rounded-lg border-2 border-dashed p-4 text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                    data-testid="add-contact-card"
                  >
                    <User className="h-5 w-5" />
                    <span className="font-medium text-sm">
                      {t('addNewContact')}
                    </span>
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              )}
            </>
          )}

          {contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              onClose={handleCloseContextMenu}
            >
              <ContextMenuItem
                icon={<Pencil className="h-4 w-4" />}
                onClick={handleEdit}
              >
                {t('edit')}
              </ContextMenuItem>
              <ContextMenuItem
                icon={<Info className="h-4 w-4" />}
                onClick={handleGetInfo}
              >
                {t('getInfo')}
              </ContextMenuItem>
              <ContextMenuItem
                icon={<Download className="h-4 w-4" />}
                onClick={handleExportContact}
              >
                {t('exportVCard')}
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
      </div>
    </div>
  );
}
