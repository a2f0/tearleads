import { useCallback, useState } from 'react';
import {
  getCurrentInstanceId,
  getDatabase,
  getDatabaseAdapter,
  runLocalWrite
} from '@/db';
import { contactEmails, contactPhones, contacts } from '@/db/schema';
import {
  createContactDocument,
  indexDocuments,
  type SearchableDocument
} from '@/search';

/** Parsed CSV data with headers and rows */
export interface ParsedCSV {
  headers: string[];
  rows: string[][];
}

/** Mapping of target field to CSV column index */
export interface ColumnMapping {
  firstName: number | null;
  lastName: number | null;
  email1Label: number | null;
  email1Value: number | null;
  email2Label: number | null;
  email2Value: number | null;
  phone1Label: number | null;
  phone1Value: number | null;
  phone2Label: number | null;
  phone2Value: number | null;
  phone3Label: number | null;
  phone3Value: number | null;
  birthday: number | null;
}

export interface ImportResult {
  total: number;
  imported: number;
  skipped: number;
  errors: string[];
}

/**
 * Parse a CSV line, handling quoted fields with commas
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Parse CSV file into memory (headers + rows)
 * Handles multiline quoted fields (e.g., addresses spanning multiple lines)
 */
export function parseCSV(text: string): ParsedCSV {
  // First, split into logical lines handling multiline quoted fields
  const logicalLines: string[] = [];
  let currentLine = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (char === '"') {
      // Check for escaped quote
      if (inQuotes && text[i + 1] === '"') {
        currentLine += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
        currentLine += char;
      }
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      // End of logical line (not inside quotes)
      if (currentLine.trim()) {
        logicalLines.push(currentLine);
      }
      currentLine = '';
      // Skip \r\n as single newline
      if (char === '\r' && text[i + 1] === '\n') {
        i++;
      }
    } else {
      currentLine += char;
    }
  }

  // Check for malformed CSV with unclosed quote
  if (inQuotes) {
    throw new Error('Malformed CSV: unclosed quote at end of file.');
  }

  // Don't forget the last line
  if (currentLine.trim()) {
    logicalLines.push(currentLine);
  }

  const headerLine = logicalLines[0];
  if (!headerLine) {
    return { headers: [], rows: [] };
  }

  const headers = parseCSVLine(headerLine);
  const rows: string[][] = [];

  for (let i = 1; i < logicalLines.length; i++) {
    const line = logicalLines[i];
    if (line) {
      rows.push(parseCSVLine(line));
    }
  }

  return { headers, rows };
}

export function useContactsImport() {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  /**
   * Parse a CSV file into memory without any column detection
   */
  const parseFile = useCallback(async (file: File): Promise<ParsedCSV> => {
    const text = await file.text();
    return parseCSV(text);
  }, []);

  /**
   * Import contacts using the provided column mapping
   */
  const importContacts = useCallback(
    async (data: ParsedCSV, mapping: ColumnMapping): Promise<ImportResult> => {
      const result: ImportResult = {
        total: data.rows.length,
        imported: 0,
        skipped: 0,
        errors: []
      };

      // Validate before setting importing state to avoid UI flicker
      if (mapping.firstName === null) {
        result.errors.push('First Name column must be mapped');
        return result;
      }
      const firstNameIndex = mapping.firstName;

      setImporting(true);
      setProgress(0);

      const importedDocs: SearchableDocument[] = [];
      const db = getDatabase();

      let processedCount = 0;
      try {
        await runLocalWrite(async () => {
          const adapter = getDatabaseAdapter();
          await adapter.beginTransaction();
          try {
            for (const row of data.rows) {
              const firstName = row[firstNameIndex]?.trim() ?? '';

              if (!firstName) {
                result.skipped++;
                processedCount++;
                setProgress(
                  Math.round((processedCount / data.rows.length) * 100)
                );
                continue;
              }

              const lastName =
                mapping.lastName !== null
                  ? row[mapping.lastName]?.trim() || null
                  : null;
              const birthday =
                mapping.birthday !== null
                  ? row[mapping.birthday]?.trim() || null
                  : null;

              // Extract grouped values (emails/phones) with labels
              const extractGroupedValues = (
                groups: ReadonlyArray<{
                  valueKey: keyof ColumnMapping;
                  labelKey: keyof ColumnMapping;
                }>
              ) => {
                const results: { value: string; label: string | null }[] = [];
                for (const group of groups) {
                  const valueIndex = mapping[group.valueKey];
                  if (valueIndex !== null) {
                    const value = row[valueIndex]?.trim();
                    if (value) {
                      const labelIndex = mapping[group.labelKey];
                      const label =
                        labelIndex !== null
                          ? row[labelIndex]?.trim() || null
                          : null;
                      results.push({ value, label });
                    }
                  }
                }
                return results;
              };

              const emailGroups: ReadonlyArray<{
                valueKey: keyof ColumnMapping;
                labelKey: keyof ColumnMapping;
              }> = [
                { valueKey: 'email1Value', labelKey: 'email1Label' },
                { valueKey: 'email2Value', labelKey: 'email2Label' }
              ];
              const emails = extractGroupedValues(emailGroups);

              const phoneGroups: ReadonlyArray<{
                valueKey: keyof ColumnMapping;
                labelKey: keyof ColumnMapping;
              }> = [
                { valueKey: 'phone1Value', labelKey: 'phone1Label' },
                { valueKey: 'phone2Value', labelKey: 'phone2Label' },
                { valueKey: 'phone3Value', labelKey: 'phone3Label' }
              ];
              const phones = extractGroupedValues(phoneGroups);

              try {
                const contactId = crypto.randomUUID();
                const now = new Date();

                // Insert contact
                await db.insert(contacts).values({
                  id: contactId,
                  firstName,
                  lastName,
                  birthday,
                  createdAt: now,
                  updatedAt: now
                });

                // Batch insert emails for better performance
                if (emails.length > 0) {
                  await db.insert(contactEmails).values(
                    emails.map((email, i) => ({
                      id: crypto.randomUUID(),
                      contactId,
                      email: email.value,
                      label: email.label,
                      isPrimary: i === 0
                    }))
                  );
                }

                // Batch insert phones for better performance
                if (phones.length > 0) {
                  await db.insert(contactPhones).values(
                    phones.map((phone, i) => ({
                      id: crypto.randomUUID(),
                      contactId,
                      phoneNumber: phone.value,
                      label: phone.label,
                      isPrimary: i === 0
                    }))
                  );
                }

                importedDocs.push(
                  createContactDocument(
                    contactId,
                    firstName,
                    lastName,
                    emails.length > 0
                      ? emails.map((email) => email.value).join(' ')
                      : null,
                    phones.length > 0
                      ? phones.map((phone) => phone.value).join(' ')
                      : null,
                    now.getTime(),
                    now.getTime()
                  )
                );
                result.imported++;
              } catch (err) {
                throw new Error(
                  `Failed to import ${firstName}: ${err instanceof Error ? err.message : 'Unknown error'}`
                );
              }

              processedCount++;
              setProgress(
                Math.round((processedCount / data.rows.length) * 100)
              );
            }
            await adapter.commitTransaction();
          } catch (err) {
            await adapter.rollbackTransaction();
            throw err;
          }
        });
      } catch (err) {
        result.imported = 0;
        result.skipped = data.rows.length;
        result.errors.push(
          err instanceof Error
            ? err.message
            : 'Failed to import contacts: Unknown error'
        );
      }

      const currentInstanceId = getCurrentInstanceId();
      if (currentInstanceId && importedDocs.length > 0) {
        try {
          await indexDocuments(currentInstanceId, importedDocs);
        } catch (indexErr) {
          console.warn('Failed to index imported contacts:', indexErr);
        }
      }

      setImporting(false);
      return result;
    },
    []
  );

  return { parseFile, importContacts, importing, progress };
}
