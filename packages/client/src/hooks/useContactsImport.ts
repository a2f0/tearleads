import { useCallback, useState } from 'react';
import { getDatabaseAdapter } from '../db';

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

      setImporting(true);
      setProgress(0);

      const adapter = getDatabaseAdapter();

      let processedCount = 0;
      for (const row of data.rows) {
        const firstName = row[mapping.firstName]?.trim() ?? '';

        if (!firstName) {
          result.skipped++;
          processedCount++;
          setProgress(Math.round((processedCount / data.rows.length) * 100));
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
                  labelIndex !== null ? row[labelIndex]?.trim() || null : null;
                results.push({ value, label });
              }
            }
          }
          return results;
        };

        const emailGroups = [
          { valueKey: 'email1Value', labelKey: 'email1Label' },
          { valueKey: 'email2Value', labelKey: 'email2Label' }
        ] as const;
        const emails = extractGroupedValues(emailGroups);

        const phoneGroups = [
          { valueKey: 'phone1Value', labelKey: 'phone1Label' },
          { valueKey: 'phone2Value', labelKey: 'phone2Label' },
          { valueKey: 'phone3Value', labelKey: 'phone3Label' }
        ] as const;
        const phones = extractGroupedValues(phoneGroups);

        try {
          await adapter.beginTransaction();

          const contactId = crypto.randomUUID();
          const now = Date.now();

          // Insert contact
          await adapter.execute(
            `INSERT INTO contacts (id, first_name, last_name, birthday, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [contactId, firstName, lastName, birthday, now, now]
          );

          // Insert emails
          for (const [i, email] of emails.entries()) {
            await adapter.execute(
              `INSERT INTO contact_emails (id, contact_id, email, label, is_primary)
               VALUES (?, ?, ?, ?, ?)`,
              [
                crypto.randomUUID(),
                contactId,
                email.value,
                email.label,
                i === 0 ? 1 : 0
              ]
            );
          }

          // Insert phones
          for (const [i, phone] of phones.entries()) {
            await adapter.execute(
              `INSERT INTO contact_phones (id, contact_id, phone_number, label, is_primary)
               VALUES (?, ?, ?, ?, ?)`,
              [
                crypto.randomUUID(),
                contactId,
                phone.value,
                phone.label,
                i === 0 ? 1 : 0
              ]
            );
          }

          await adapter.commitTransaction();
          result.imported++;
        } catch (err) {
          await adapter.rollbackTransaction();
          result.skipped++;
          result.errors.push(
            `Failed to import ${firstName}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }

        processedCount++;
        setProgress(Math.round((processedCount / data.rows.length) * 100));
      }

      setImporting(false);
      return result;
    },
    []
  );

  return { parseFile, importContacts, importing, progress };
}
