import { useCallback, useState } from 'react';
import { getDatabaseAdapter } from '../db';

interface LabeledValue {
  label: string | null;
  value: string;
}

interface ParsedContact {
  firstName: string;
  lastName: string | null;
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
 * Normalize dashes (en-dash, em-dash, etc.) to regular hyphens for comparison
 */
function normalizeDashes(str: string): string {
  return str.replace(/[\u2013\u2014\u2015]/g, '-');
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
  // Normalize headers for comparison (lowercase and normalize dashes)
  const normalizedHeaders = headers.map((h) =>
    normalizeDashes(h.toLowerCase())
  );
  const contacts: ParsedContact[] = [];

  // Find column indices
  const firstNameIdx = normalizedHeaders.findIndex(
    (h) => h === 'first name' || h === 'given name'
  );
  const lastNameIdx = normalizedHeaders.findIndex(
    (h) => h === 'last name' || h === 'family name'
  );
  const nameIdx = normalizedHeaders.findIndex((h) => h === 'name');
  const birthdayIdx = normalizedHeaders.findIndex((h) => h === 'birthday');

  // Find email columns (E-mail N - Label/Value or E-mail N - Type/Value)
  // Google uses en-dash (–) but we normalize to hyphen (-)
  const emailColumns: { labelIdx: number; valueIdx: number }[] = [];
  for (let i = 1; i <= 10; i++) {
    const emailLabelHeaders = [
      `e-mail ${i} - label`,
      `e-mail ${i} - type`,
      `email ${i} - label`,
      `email ${i} - type`
    ];
    const emailValueHeaders = [`e-mail ${i} - value`, `email ${i} - value`];
    const labelIdx = normalizedHeaders.findIndex((h) =>
      emailLabelHeaders.includes(h)
    );
    const valueIdx = normalizedHeaders.findIndex((h) =>
      emailValueHeaders.includes(h)
    );
    if (valueIdx !== -1) {
      emailColumns.push({ labelIdx, valueIdx });
    }
  }

  // Find phone columns (Phone N - Label/Value or Phone N - Type/Value)
  const phoneColumns: { labelIdx: number; valueIdx: number }[] = [];
  for (let i = 1; i <= 10; i++) {
    const labelIdx = normalizedHeaders.findIndex((h) =>
      [`phone ${i} - label`, `phone ${i} - type`].includes(h)
    );
    const valueIdx = normalizedHeaders.findIndex(
      (h) => h === `phone ${i} - value`
    );
    if (valueIdx !== -1) {
      phoneColumns.push({ labelIdx, valueIdx });
    }
  }

  // Parse data rows
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = parseCSVLine(line);

    // Try Given Name first, fall back to Name column, then try to split Name
    let firstName = firstNameIdx !== -1 ? (values[firstNameIdx] ?? '') : '';
    let lastName = lastNameIdx !== -1 ? values[lastNameIdx] || null : null;

    // If no first name but we have a Name column, use it
    if (!firstName && nameIdx !== -1) {
      const fullName = values[nameIdx] ?? '';
      if (fullName) {
        // Split full name into first and last (simple split on first space)
        const nameParts = fullName.trim().split(/\s+/);
        firstName = nameParts[0] ?? '';
        if (nameParts.length > 1 && !lastName) {
          lastName = nameParts.slice(1).join(' ');
        }
      }
    }

    if (!firstName) continue; // Skip contacts without any name

    const birthday = birthdayIdx !== -1 ? values[birthdayIdx] || null : null;

    // Extract emails
    const emails: LabeledValue[] = [];
    for (const col of emailColumns) {
      const value = values[col.valueIdx];
      if (value) {
        const label = col.labelIdx !== -1 ? values[col.labelIdx] || null : null;
        emails.push({ label, value });
      }
    }

    // Extract phones
    const phones: LabeledValue[] = [];
    for (const col of phoneColumns) {
      const value = values[col.valueIdx];
      if (value) {
        const label = col.labelIdx !== -1 ? values[col.labelIdx] || null : null;
        phones.push({ label, value });
      }
    }

    contacts.push({ firstName, lastName, birthday, emails, phones });
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
            `INSERT INTO contacts (id, first_name, last_name, birthday, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?)`,
            [
              contactId,
              contact.firstName,
              contact.lastName,
              contact.birthday,
              now,
              now
            ]
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
