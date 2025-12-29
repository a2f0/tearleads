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
 */
export function parseCSV(text: string): ParsedCSV {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headerLine = lines[0];

  if (!headerLine) {
    return { headers: [], rows: [] };
  }

  const headers = parseCSVLine(headerLine);
  const rows: string[][] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
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

        // Extract emails with labels
        const emails: { value: string; label: string | null }[] = [];
        const email1Value =
          mapping.email1Value !== null
            ? row[mapping.email1Value]?.trim() || null
            : null;
        if (email1Value) {
          const email1Label =
            mapping.email1Label !== null
              ? row[mapping.email1Label]?.trim() || null
              : null;
          emails.push({ value: email1Value, label: email1Label });
        }
        const email2Value =
          mapping.email2Value !== null
            ? row[mapping.email2Value]?.trim() || null
            : null;
        if (email2Value) {
          const email2Label =
            mapping.email2Label !== null
              ? row[mapping.email2Label]?.trim() || null
              : null;
          emails.push({ value: email2Value, label: email2Label });
        }

        // Extract phones with labels
        const phones: { value: string; label: string | null }[] = [];
        const phone1Value =
          mapping.phone1Value !== null
            ? row[mapping.phone1Value]?.trim() || null
            : null;
        if (phone1Value) {
          const phone1Label =
            mapping.phone1Label !== null
              ? row[mapping.phone1Label]?.trim() || null
              : null;
          phones.push({ value: phone1Value, label: phone1Label });
        }
        const phone2Value =
          mapping.phone2Value !== null
            ? row[mapping.phone2Value]?.trim() || null
            : null;
        if (phone2Value) {
          const phone2Label =
            mapping.phone2Label !== null
              ? row[mapping.phone2Label]?.trim() || null
              : null;
          phones.push({ value: phone2Value, label: phone2Label });
        }
        const phone3Value =
          mapping.phone3Value !== null
            ? row[mapping.phone3Value]?.trim() || null
            : null;
        if (phone3Value) {
          const phone3Label =
            mapping.phone3Label !== null
              ? row[mapping.phone3Label]?.trim() || null
              : null;
          phones.push({ value: phone3Value, label: phone3Label });
        }

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
