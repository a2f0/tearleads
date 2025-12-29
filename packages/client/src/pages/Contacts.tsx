import {
  Database,
  Loader2,
  Mail,
  Phone,
  RefreshCw,
  Upload,
  User
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ColumnMapper } from '@/components/contacts/ColumnMapper';
import { Button } from '@/components/ui/button';
import { Dropzone } from '@/components/ui/dropzone';
import { getDatabaseAdapter } from '@/db';
import { useDatabaseContext } from '@/db/hooks';
import {
  type ColumnMapping,
  type ParsedCSV,
  useContactsImport
} from '@/hooks/useContactsImport';

interface ContactInfo {
  id: string;
  firstName: string;
  lastName: string | null;
  birthday: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  createdAt: Date;
}

export function Contacts() {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasFetched, setHasFetched] = useState(false);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  // CSV parsing and mapping state
  const [parsedData, setParsedData] = useState<ParsedCSV | null>(null);

  const { parseFile, importContacts, importing, progress } =
    useContactsImport();

  const fetchContacts = useCallback(async () => {
    if (!isUnlocked) return;

    setLoading(true);
    setError(null);

    try {
      const adapter = getDatabaseAdapter();

      // Fetch contacts with their primary email and phone using LEFT JOINs
      const result = await adapter.execute(
        `SELECT
          c.id,
          c.first_name,
          c.last_name,
          c.birthday,
          c.created_at,
          ce.email as primary_email,
          cp.phone_number as primary_phone
         FROM contacts c
         LEFT JOIN contact_emails ce ON ce.contact_id = c.id AND ce.is_primary = 1
         LEFT JOIN contact_phones cp ON cp.contact_id = c.id AND cp.is_primary = 1
         WHERE c.deleted = 0
         ORDER BY c.first_name ASC`,
        []
      );

      const contactList = result.rows.map((row) => {
        const r = row as Record<string, unknown>;
        return {
          id: r['id'] as string,
          firstName: r['first_name'] as string,
          lastName: (r['last_name'] as string) || null,
          birthday: (r['birthday'] as string) || null,
          primaryEmail: (r['primary_email'] as string) || null,
          primaryPhone: (r['primary_phone'] as string) || null,
          createdAt: new Date(r['created_at'] as number)
        };
      });

      setContacts(contactList);
      setHasFetched(true);
    } catch (err) {
      console.error('Failed to fetch contacts:', err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  useEffect(() => {
    if (isUnlocked && !hasFetched && !loading) {
      fetchContacts();
    }
  }, [isUnlocked, hasFetched, loading, fetchContacts]);

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <User className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Contacts</h1>
        </div>
        {isUnlocked && !parsedData && (
          <Button
            variant="outline"
            size="sm"
            onClick={fetchContacts}
            disabled={loading}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`}
            />
            Refresh
          </Button>
        )}
      </div>

      {isLoading && (
        <div className="rounded-lg border p-8 text-center text-muted-foreground">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && (
        <div className="rounded-lg border p-8 text-center">
          <Database className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <p className="mt-4 text-muted-foreground">
            Database is locked. Unlock it from the SQLite page to view contacts.
          </p>
        </div>
      )}

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

          {/* Contacts List */}
          {!loading && contacts.length === 0 && hasFetched && (
            <div className="rounded-lg border p-8 text-center text-muted-foreground">
              No contacts yet. Import a CSV to get started.
            </div>
          )}

          {contacts.length > 0 && (
            <div className="space-y-2">
              {contacts.map((contact) => (
                <div
                  key={contact.id}
                  className="flex items-center justify-between rounded-lg border p-4"
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
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
