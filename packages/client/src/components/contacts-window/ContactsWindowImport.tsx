import { Loader2, Upload } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { ColumnMapper } from '@/components/contacts/column-mapper';
import { InlineUnlock } from '@/components/sqlite/InlineUnlock';
import { Button } from '@/components/ui/button';
import { useDatabaseContext } from '@/db/hooks';
import {
  type ColumnMapping,
  type ImportResult,
  type ParsedCSV,
  useContactsImport
} from '@/hooks/useContactsImport';

interface ContactsWindowImportProps {
  file: File | null;
  onDone: () => void;
  onImported: (result: ImportResult) => void;
}

export function ContactsWindowImport({
  file,
  onDone,
  onImported
}: ContactsWindowImportProps) {
  const { isUnlocked, isLoading } = useDatabaseContext();
  const { parseFile, importContacts, importing, progress } =
    useContactsImport();
  const [parsedData, setParsedData] = useState<ParsedCSV | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isParsing, setIsParsing] = useState(false);

  useEffect(() => {
    if (!file || !isUnlocked) return;
    let isActive = true;

    setIsParsing(true);
    setError(null);
    setParsedData(null);
    setImportResult(null);

    const parse = async () => {
      try {
        const data = await parseFile(file);
        if (!isActive) return;
        if (data.headers.length === 0) {
          setError('CSV file is empty or has no headers');
          return;
        }
        setParsedData(data);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : 'Failed to parse CSV');
      } finally {
        if (isActive) {
          setIsParsing(false);
        }
      }
    };

    void parse();

    return () => {
      isActive = false;
    };
  }, [file, isUnlocked, parseFile]);

  const handleImport = useCallback(
    async (mapping: ColumnMapping) => {
      if (!parsedData) return;

      try {
        const result = await importContacts(parsedData, mapping);
        setImportResult(result);
        setParsedData(null);
        if (result.imported > 0) {
          onImported(result);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to import CSV');
      }
    },
    [importContacts, onImported, parsedData]
  );

  const handleCancel = useCallback(() => {
    setParsedData(null);
    setImportResult(null);
    setError(null);
  }, []);

  return (
    <div className="flex h-full flex-col space-y-3 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-muted-foreground" />
          <h2 className="font-semibold text-sm">Import CSV</h2>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDone}
          disabled={importing || isParsing}
        >
          Done
        </Button>
      </div>

      {isLoading && (
        <div className="rounded-lg border p-4 text-center text-muted-foreground text-xs">
          Loading database...
        </div>
      )}

      {!isLoading && !isUnlocked && <InlineUnlock description="contacts" />}

      {isUnlocked && (
        <>
          {error && (
            <div className="whitespace-pre-line rounded-lg border border-destructive bg-destructive/10 p-2 text-destructive text-xs">
              {error}
            </div>
          )}

          {isParsing && (
            <div className="flex items-center gap-2 rounded-lg border p-4 text-muted-foreground text-xs">
              <Loader2 className="h-4 w-4 animate-spin" />
              Parsing CSV...
            </div>
          )}

          {parsedData && (
            <div className="rounded-lg border p-3">
              <ColumnMapper
                data={parsedData}
                onImport={handleImport}
                onCancel={handleCancel}
                importing={importing}
              />
              {importing && (
                <div className="mt-3">
                  <div className="mb-1 flex items-center gap-2 text-muted-foreground text-xs">
                    <Loader2 className="h-3 w-3 animate-spin" />
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

          {!parsedData && !isParsing && !error && !importResult && (
            <div className="rounded-lg border p-4 text-muted-foreground text-xs">
              Choose File &gt; Import CSV to select a file.
            </div>
          )}

          {importResult && (
            <div className="rounded-lg border p-3 text-xs">
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
        </>
      )}
    </div>
  );
}
