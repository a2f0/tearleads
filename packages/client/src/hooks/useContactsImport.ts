import { useCallback, useState } from 'react';
import { getDatabaseAdapter } from '../db';

interface LabeledValue {
  label: string | null;
  value: string;
}

interface ParsedContact {
  firstName: string;
  birthday: string | null;
  emails: LabeledValue[];
  phones: LabeledValue[];
}

interface ImportResult {
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
 * Parse Google Contacts CSV format
 */
function parseGoogleContactsCSV(text: string): ParsedContact[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const headerLine = lines[0];
  if (lines.length < 2 || !headerLine) return [];

  const headers = parseCSVLine(headerLine);
  const contacts: ParsedContact[] = [];

  // Find column indices
  const firstNameIdx = headers.findIndex(
    (h) => h.toLowerCase() === 'first name' || h.toLowerCase() === 'given name'
  );
  const birthdayIdx = headers.findIndex((h) => h.toLowerCase() === 'birthday');

  // Find email columns (E-mail N - Type/Value or Email N - Type/Value)
  const emailColumns: { typeIdx: number; valueIdx: number }[] = [];
  for (let i = 1; i <= 10; i++) {
    const typeIdx = headers.findIndex(
      (h) =>
        h.toLowerCase() === `e-mail ${i} - type` ||
        h.toLowerCase() === `email ${i} - type`
    );
    const valueIdx = headers.findIndex(
      (h) =>
        h.toLowerCase() === `e-mail ${i} - value` ||
        h.toLowerCase() === `email ${i} - value`
    );
    if (valueIdx !== -1) {
      emailColumns.push({ typeIdx, valueIdx });
    }
  }

  // Find phone columns (Phone N - Type/Value)
  const phoneColumns: { typeIdx: number; valueIdx: number }[] = [];
  for (let i = 1; i <= 10; i++) {
    const typeIdx = headers.findIndex(
      (h) => h.toLowerCase() === `phone ${i} - type`
    );
    const valueIdx = headers.findIndex(
      (h) => h.toLowerCase() === `phone ${i} - value`
    );
    if (valueIdx !== -1) {
      phoneColumns.push({ typeIdx, valueIdx });
    }
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = parseCSVLine(line);

    const firstName = firstNameIdx !== -1 ? (values[firstNameIdx] ?? '') : '';
    if (!firstName) continue; // Skip contacts without first name

    const birthday = birthdayIdx !== -1 ? values[birthdayIdx] || null : null;

    // Extract emails
    const emails: LabeledValue[] = [];
    for (const col of emailColumns) {
      const value = values[col.valueIdx];
      if (value) {
        const label = col.typeIdx !== -1 ? values[col.typeIdx] || null : null;
        emails.push({ label, value });
      }
    }

    // Extract phones
    const phones: LabeledValue[] = [];
    for (const col of phoneColumns) {
      const value = values[col.valueIdx];
      if (value) {
        const label = col.typeIdx !== -1 ? values[col.typeIdx] || null : null;
        phones.push({ label, value });
      }
    }

    contacts.push({ firstName, birthday, emails, phones });
  }

  return contacts;
}

export function useContactsImport() {
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);

  const importCSV = useCallback(async (file: File): Promise<ImportResult> => {
    setImporting(true);
    setProgress(0);

    const result: ImportResult = {
      total: 0,
      imported: 0,
      skipped: 0,
      errors: []
    };

    try {
      // Read file
      const text = await file.text();
      setProgress(10);

      // Parse CSV
      const contacts = parseGoogleContactsCSV(text);
      result.total = contacts.length;
      setProgress(20);

      if (contacts.length === 0) {
        result.errors.push('No valid contacts found in CSV');
        return result;
      }

      const adapter = getDatabaseAdapter();

      // Import each contact
      let importedCount = 0;
      for (const contact of contacts) {
        try {
          await adapter.beginTransaction();

          const contactId = crypto.randomUUID();
          const now = Date.now();

          // Insert contact
          await adapter.execute(
            `INSERT INTO contacts (id, first_name, birthday, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?)`,
            [contactId, contact.firstName, contact.birthday, now, now]
          );

          // Insert emails
          for (const [j, email] of contact.emails.entries()) {
            await adapter.execute(
              `INSERT INTO contact_emails (id, contact_id, email, label, is_primary)
                 VALUES (?, ?, ?, ?, ?)`,
              [
                crypto.randomUUID(),
                contactId,
                email.value,
                email.label,
                j === 0 ? 1 : 0
              ]
            );
          }

          // Insert phones
          for (const [j, phone] of contact.phones.entries()) {
            await adapter.execute(
              `INSERT INTO contact_phones (id, contact_id, phone_number, label, is_primary)
                 VALUES (?, ?, ?, ?, ?)`,
              [
                crypto.randomUUID(),
                contactId,
                phone.value,
                phone.label,
                j === 0 ? 1 : 0
              ]
            );
          }

          await adapter.commitTransaction();
          result.imported++;
        } catch (err) {
          await adapter.rollbackTransaction();
          result.skipped++;
          result.errors.push(
            `Failed to import ${contact.firstName}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
        }

        importedCount++;
        // Update progress (20% to 100%)
        setProgress(20 + Math.round((importedCount / contacts.length) * 80));
      }
    } catch (err) {
      result.errors.push(
        `Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`
      );
    } finally {
      setImporting(false);
    }

    return result;
  }, []);

  return { importCSV, importing, progress };
}
