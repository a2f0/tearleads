import { useVirtualizer } from '@tanstack/react-virtual';
import { and, asc, eq, like, or, type SQL } from 'drizzle-orm';
import {
  Info,
  Loader2,
  Mail,
  Phone,
  Search,
  Trash2,
  Upload,
  User,
  X
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColumnMapper } from '@/components/contacts/column-mapper';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { ContextMenu, ContextMenuItem } from '@/components/ui/context-menu';
import { Dropzone } from '@/components/ui/dropzone';
import { RefreshButton } from '@/components/ui/refresh-button';
import { getDatabase } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import {
  contactEmails,
  contactPhones,
  contacts as contactsTable
} from '@/db/schema';
import {
  type ColumnMapping,
  type ParsedCSV,
  useContactsImport
} from '@/hooks/useContactsImport';
import { useNavigateWithFrom } from '@/lib/navigation';
import { AddContactCard } from './AddContactCard';

interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  createdAt: Date;
}

const ROW_HEIGHT_ESTIMATE = 72;

export function Contacts() {
  const navigate = useNavigate();
  const navigateWithFrom = useNavigateWithFrom();
  const { isUnlocked, isLoading, currentInstanceId } = useDatabaseContext();
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    contact: ContactInfo;
    x: number;
    y: number;
  } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: contacts.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT_ESTIMATE,
    overscan: 5
  });

  const virtualItems = virtualizer.getVirtualItems();

  // Debounce search query
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [searchQuery]);

  // CSV parsing and mapping state
  const [parsedData, setParsedData] = useState<ParsedCSV | null>(null);

  const { parseFile, importContacts, importing, progress } =
    useContactsImport();

  // Focus search input when database is unlocked
  useEffect(() => {
    if (isUnlocked && !parsedData) {
      searchInputRef.current?.focus();
    }
  }, [isUnlocked, parsedData]);

  const fetchContacts = useCallback(
    async (search?: string) => {
      if (!isUnlocked) return;

      setLoading(true);
      setError(null);

      try {
        const db = getDatabase();

        // Build query with optional search
        const searchTerm = search?.trim();
        const searchPattern = searchTerm ? `%${searchTerm}%` : null;

        // Query contacts with LEFT JOINs for primary email/phone
        const baseQuery = db
          .select({
            id: contactsTable.id,
            firstName: contactsTable.firstName,
            lastName: contactsTable.lastName,
            birthday: contactsTable.birthday,
            createdAt: contactsTable.createdAt,
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
          );

        // Build where conditions
        const baseCondition = eq(contactsTable.deleted, false);
        let whereCondition: SQL | undefined;

        if (searchPattern) {
          // Search across name, email, and phone (SQLite LIKE is case-insensitive by default)
          const searchCondition = or(
            like(contactsTable.firstName, searchPattern),
            like(contactsTable.lastName, searchPattern),
            like(contactEmails.email, searchPattern),
            like(contactPhones.phoneNumber, searchPattern)
          );
          whereCondition = and(baseCondition, searchCondition);
        } else {
          whereCondition = baseCondition;
        }

        const result = await baseQuery
          .where(whereCondition)
          .orderBy(asc(contactsTable.firstName));

        const contactList = result.map((row) => ({
          id: row.id,
          firstName: row.firstName,
          lastName: row.lastName,
          birthday: row.birthday,
          primaryEmail: row.primaryEmail,
          primaryPhone: row.primaryPhone,
          createdAt: row.createdAt
        }));

        setContacts(contactList);
        setHasFetched(true);
      } catch (err) {
        console.error('Failed to fetch contacts:', err);
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [isUnlocked]
  );

  // Track the instance ID for which we've fetched contacts
  // Using a ref avoids React's state batching issues
  const fetchedForInstanceRef = useRef<string | null>(null);

  // Fetch contacts on initial load, when search query changes, or when instance changes
  useEffect(() => {
    if (!isUnlocked) return;

    // Check if we need to reset for instance change
    if (
      fetchedForInstanceRef.current !== currentInstanceId &&
      fetchedForInstanceRef.current !== null
    ) {
      // Instance changed - clear contacts and reset state
      setContacts([]);
      setHasFetched(false);
      setError(null);
      setSearchQuery('');
      setDebouncedSearch('');
    }

    // Update ref before fetching
    fetchedForInstanceRef.current = currentInstanceId;

    // Defer fetch to next tick to ensure database singleton is updated
    const timeoutId = setTimeout(() => {
      fetchContacts(debouncedSearch);
    }, 0);

    return () => clearTimeout(timeoutId);
  }, [isUnlocked, debouncedSearch, currentInstanceId, fetchContacts]);

  const handleFilesSelected = useCallback(
    async (files: File[]) => {
      if (!isUnlocked || files.length === 0) return;

      setError(null);
      setImportResult(null);

      const file = files[0];
      if (!file) return;

      try {
        const data = await parseFile(file);
        if (data.headers.length === 0) {
          setError('CSV file is empty or has no headers');
          return;
        }
        setParsedData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      }
    },
    [isUnlocked, parseFile]
  );

  const handleImport = useCallback(
    async (mapping: ColumnMapping) => {
      if (!parsedData) return;

      const result = await importContacts(parsedData, mapping);

      setImportResult({
        imported: result.imported,
        skipped: result.skipped,
        errors: result.errors
      });

      setParsedData(null);

      // Refresh contacts list
      await fetchContacts();
    },
    [parsedData, importContacts, fetchContacts]
  );

  const handleCancelMapping = useCallback(() => {
    setParsedData(null);
  }, []);

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

  const handleDelete = useCallback(async () => {
    if (!contextMenu) return;

    try {
      const db = getDatabase();
      await db
        .update(contactsTable)
        .set({ deleted: true, updatedAt: new Date() })
        .where(eq(contactsTable.id, contextMenu.contact.id));

      setContextMenu(null);
      await fetchContacts(debouncedSearch);
    } catch (err) {
      console.error('Failed to delete contact:', err);
      setError(err instanceof Error ? err.message : String(err));
      setContextMenu(null);
    }
  }, [contextMenu, fetchContacts, debouncedSearch]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  return (
    <div className="flex h-full flex-col space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <User className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Contacts</h1>
        </div>
        {isUnlocked && !parsedData && (
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1 sm:flex-initial">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-full rounded-md border bg-background py-2 pr-10 pl-9 text-base placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring sm:w-48"
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

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="contacts" />}

      {isUnlocked && parsedData && (
        <div className="rounded-lg border p-4">
          <div className="mb-4 flex items-center gap-2">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <h2 className="font-semibold">Map CSV Columns</h2>
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
                Importing... {progress}%
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
          {/* Import Section */}
          <div className="rounded-lg border p-4">
            <div className="mb-3 flex items-center gap-2">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <h2 className="font-semibold">Import CSV</h2>
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
                  Imported {importResult.imported} contact
                  {importResult.imported !== 1 ? 's' : ''}
                  {importResult.skipped > 0 &&
                    `, skipped ${importResult.skipped}`}
                </p>
                {importResult.errors.length > 0 && (
                  <ul className="mt-2 list-inside list-disc text-destructive">
                    {importResult.errors.slice(0, 5).map((err) => (
                      <li key={err}>{err}</li>
                    ))}
                    {importResult.errors.length > 5 && (
                      <li>...and {importResult.errors.length - 5} more</li>
                    )}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Error Display */}
          {error && (
            <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* Add New Contact Card (shown when empty) */}
          {!loading && contacts.length === 0 && hasFetched && !searchQuery && (
            <AddContactCard
              onClick={() => navigate('/contacts/new')}
              size="large"
            />
          )}

          {!loading && contacts.length === 0 && hasFetched && searchQuery && (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              No contacts found matching "{searchQuery}"
            </div>
          )}

          {contacts.length > 0 && (
            <div className="flex min-h-0 flex-1 flex-col space-y-2">
              <p className="text-muted-foreground text-sm">
                {`${contacts.length} contact${contacts.length !== 1 ? 's' : ''}${searchQuery ? ' found' : ''}`}
              </p>
              <div className="flex-1 rounded-lg border">
                <div ref={parentRef} className="h-full overflow-auto">
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
                                fromLabel: 'Back to Contacts'
                              })
                            }
                            onContextMenu={(e) => handleContextMenu(e, contact)}
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
              </div>
              {/* Add New Contact Card (always at bottom) */}
              <AddContactCard
                onClick={() => navigate('/contacts/new')}
                size="small"
              />
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
            icon={<Info className="h-4 w-4" />}
            onClick={handleGetInfo}
          >
            Get info
          </ContextMenuItem>
          <ContextMenuItem
            icon={<Trash2 className="h-4 w-4" />}
            onClick={handleDelete}
          >
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
