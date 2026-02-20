/**
 * Hook for contacts CSV import UI handling.
 */

import { useCallback, useState } from 'react';
import {
  type ColumnMapping,
  type ParsedCSV,
  useContactsImport
} from '@/hooks/contacts';

interface ImportResult {
  imported: number;
  skipped: number;
  errors: string[];
}

interface UseContactsImportUIResult {
  parsedData: ParsedCSV | null;
  importResult: ImportResult | null;
  importing: boolean;
  progress: number;
  handleFilesSelected: (files: File[]) => Promise<void>;
  handleImport: (mapping: ColumnMapping) => Promise<void>;
  handleCancelMapping: () => void;
  setImportResult: React.Dispatch<React.SetStateAction<ImportResult | null>>;
}

export function useContactsImportUI(
  isUnlocked: boolean,
  setError: (error: string | null) => void,
  fetchContacts: () => Promise<void>
): UseContactsImportUIResult {
  const [parsedData, setParsedData] = useState<ParsedCSV | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const { parseFile, importContacts, importing, progress } =
    useContactsImport();

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
    [isUnlocked, parseFile, setError]
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

  return {
    parsedData,
    importResult,
    importing,
    progress,
    handleFilesSelected,
    handleImport,
    handleCancelMapping,
    setImportResult
  };
}
