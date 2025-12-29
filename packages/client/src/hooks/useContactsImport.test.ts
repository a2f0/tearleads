import { describe, expect, it } from 'vitest';
import { parseCSV } from './useContactsImport';

describe('parseCSV', () => {
  describe('basic parsing', () => {
    it('parses a simple CSV with headers and rows', () => {
      const csv = `Name,Age,City
John,30,Boston
Jane,25,Chicago`;

      const result = parseCSV(csv);

      expect(result.headers).toEqual(['Name', 'Age', 'City']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(['John', '30', 'Boston']);
      expect(result.rows[1]).toEqual(['Jane', '25', 'Chicago']);
    });

    it('returns empty headers and rows for empty input', () => {
      const result = parseCSV('');

      expect(result.headers).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it('returns empty headers and rows for whitespace-only input', () => {
      const result = parseCSV('   \n\n   ');

      expect(result.headers).toEqual([]);
      expect(result.rows).toEqual([]);
    });

    it('parses headers only with no data rows', () => {
      const csv = 'First Name,Last Name,Email';

      const result = parseCSV(csv);

      expect(result.headers).toEqual(['First Name', 'Last Name', 'Email']);
      expect(result.rows).toEqual([]);
    });

    it('handles Windows-style line endings (CRLF)', () => {
      const csv = 'Name,Age\r\nAlice,28\r\nBob,35';

      const result = parseCSV(csv);

      expect(result.headers).toEqual(['Name', 'Age']);
      expect(result.rows).toHaveLength(2);
      expect(result.rows[0]).toEqual(['Alice', '28']);
      expect(result.rows[1]).toEqual(['Bob', '35']);
    });

    it('handles Unix-style line endings (LF)', () => {
      const csv = 'Name,Age\nAlice,28\nBob,35';

      const result = parseCSV(csv);

      expect(result.headers).toEqual(['Name', 'Age']);
      expect(result.rows).toHaveLength(2);
    });

    it('skips empty lines', () => {
      const csv = `Name,Age

Alice,28

Bob,35
`;

      const result = parseCSV(csv);

      expect(result.headers).toEqual(['Name', 'Age']);
      expect(result.rows).toHaveLength(2);
    });

    it('trims whitespace from field values', () => {
      const csv = `Name,  Age  , City
  Alice  ,  28  ,  Boston  `;

      const result = parseCSV(csv);

      expect(result.headers).toEqual(['Name', 'Age', 'City']);
      expect(result.rows[0]).toEqual(['Alice', '28', 'Boston']);
    });
  });

  describe('quoted fields', () => {
    it('parses quoted fields containing commas', () => {
      const csv = `Name,Address,Phone
"Doe, John","123 Main St, Apt 4",555-1234`;

      const result = parseCSV(csv);

      expect(result.headers).toEqual(['Name', 'Address', 'Phone']);
      expect(result.rows[0]).toEqual([
        'Doe, John',
        '123 Main St, Apt 4',
        '555-1234'
      ]);
    });

    it('handles escaped quotes within quoted fields', () => {
      const csv = `Name,Quote
"Alice","She said ""Hello"" to me"`;

      const result = parseCSV(csv);

      expect(result.rows[0]).toEqual(['Alice', 'She said "Hello" to me']);
    });

    it('handles empty quoted fields', () => {
      const csv = `Name,Middle,Last
"John","","Doe"`;

      const result = parseCSV(csv);

      expect(result.rows[0]).toEqual(['John', '', 'Doe']);
    });
  });

  describe('multiline quoted fields', () => {
    it('parses multiline addresses within quoted fields', () => {
      const csv = `Name,Address,Phone
"Alice Smith","123 Oak Street
Apartment 4B
Springfield, IL 62701
USA",555-0100`;

      const result = parseCSV(csv);

      expect(result.headers).toEqual(['Name', 'Address', 'Phone']);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[0]).toBe('Alice Smith');
      expect(result.rows[0]?.[1]).toBe(
        '123 Oak Street\nApartment 4B\nSpringfield, IL 62701\nUSA'
      );
      expect(result.rows[0]?.[2]).toBe('555-0100');
    });

    it('handles multiple rows with multiline fields', () => {
      const csv = `Name,Notes
"Bob","Line 1
Line 2"
"Carol","Single line"
"Dave","Another
multiline
note"`;

      const result = parseCSV(csv);

      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]?.[1]).toBe('Line 1\nLine 2');
      expect(result.rows[1]?.[1]).toBe('Single line');
      expect(result.rows[2]?.[1]).toBe('Another\nmultiline\nnote');
    });

    it('handles multiline fields with CRLF line endings', () => {
      const csv =
        'Name,Address\r\n"Test","123 Street\r\nCity, ST 12345\r\nUSA"';

      const result = parseCSV(csv);

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]?.[1]).toBe('123 Street\r\nCity, ST 12345\r\nUSA');
    });
  });

  describe('error handling', () => {
    it('throws error for unclosed quote at end of file', () => {
      const csv = `Name,Description
"Alice","This quote is never closed`;

      expect(() => parseCSV(csv)).toThrow(
        'Malformed CSV: unclosed quote at end of file.'
      );
    });

    it('throws error for unclosed quote in multiline field', () => {
      const csv = `Name,Notes
"Bob","This is a note
that spans multiple lines
but never closes`;

      expect(() => parseCSV(csv)).toThrow(
        'Malformed CSV: unclosed quote at end of file.'
      );
    });
  });

  describe('Google Contacts CSV format', () => {
    // Simulated Google Contacts CSV headers (subset of actual headers)
    const googleContactsHeaders = [
      'First Name',
      'Middle Name',
      'Last Name',
      'Organization Name',
      'Birthday',
      'E-mail 1 - Label',
      'E-mail 1 - Value',
      'E-mail 2 - Label',
      'E-mail 2 - Value',
      'Phone 1 - Label',
      'Phone 1 - Value',
      'Phone 2 - Label',
      'Phone 2 - Value',
      'Address 1 - Formatted'
    ].join(',');

    it('parses Google Contacts CSV with basic contact', () => {
      const csv = `${googleContactsHeaders}
Alice,,Johnson,Acme Corp,1990-05-15,Work,alice@acme.com,,,Mobile,+1 555-123-4567,,,`;

      const result = parseCSV(csv);

      expect(result.headers).toContain('First Name');
      expect(result.headers).toContain('E-mail 1 - Value');
      expect(result.headers).toContain('Phone 1 - Value');
      expect(result.rows).toHaveLength(1);

      const row = result.rows[0];
      const firstNameIdx = result.headers.indexOf('First Name');
      const lastNameIdx = result.headers.indexOf('Last Name');
      const emailValueIdx = result.headers.indexOf('E-mail 1 - Value');
      const phoneValueIdx = result.headers.indexOf('Phone 1 - Value');

      expect(row?.[firstNameIdx]).toBe('Alice');
      expect(row?.[lastNameIdx]).toBe('Johnson');
      expect(row?.[emailValueIdx]).toBe('alice@acme.com');
      expect(row?.[phoneValueIdx]).toBe('+1 555-123-4567');
    });

    it('parses Google Contacts CSV with multiline address', () => {
      const csv = `${googleContactsHeaders}
Bob,James,Williams,,,Home,bob.w@email.com,,,Mobile,+1 555-987-6543,,,"456 Elm Avenue
Suite 200
Metropolis, NY 10001
USA"`;

      const result = parseCSV(csv);

      expect(result.rows).toHaveLength(1);

      const row = result.rows[0];
      const addressIdx = result.headers.indexOf('Address 1 - Formatted');
      const address = row?.[addressIdx];

      expect(address).toBe(
        '456 Elm Avenue\nSuite 200\nMetropolis, NY 10001\nUSA'
      );
    });

    it('parses Google Contacts CSV with multiple contacts including multiline fields', () => {
      const csv = `${googleContactsHeaders}
Carol,,Davis,Tech Solutions,1985-12-01,Work,carol@techsol.io,Personal,carol.d@gmail.com,Work,+1 555-111-2222,Mobile,+1 555-333-4444,
David,M,Evans,,,,,,,,+1 555-555-5555,,,"789 Pine Road
Smalltown, CA 90210
USA"
Eve,,Franklin,Startup Inc,,Work,eve@startup.co,,,Mobile,+1 555-666-7777,,,`;

      const result = parseCSV(csv);

      expect(result.rows).toHaveLength(3);

      const carolRow = result.rows[0];
      const davidRow = result.rows[1];
      const eveRow = result.rows[2];

      // Check Carol has two emails
      const email1LabelIdx = result.headers.indexOf('E-mail 1 - Label');
      const email1ValueIdx = result.headers.indexOf('E-mail 1 - Value');
      const email2LabelIdx = result.headers.indexOf('E-mail 2 - Label');
      const email2ValueIdx = result.headers.indexOf('E-mail 2 - Value');

      expect(carolRow?.[email1LabelIdx]).toBe('Work');
      expect(carolRow?.[email1ValueIdx]).toBe('carol@techsol.io');
      expect(carolRow?.[email2LabelIdx]).toBe('Personal');
      expect(carolRow?.[email2ValueIdx]).toBe('carol.d@gmail.com');

      // Check David has multiline address
      const addressIdx = result.headers.indexOf('Address 1 - Formatted');
      expect(davidRow?.[addressIdx]).toBe(
        '789 Pine Road\nSmalltown, CA 90210\nUSA'
      );

      // Check Eve
      const firstNameIdx = result.headers.indexOf('First Name');
      expect(eveRow?.[firstNameIdx]).toBe('Eve');
    });

    it('handles Google Contacts CSV with special characters in names', () => {
      const csv = `${googleContactsHeaders}
"O'Brien",,Patrick,,,,,,,Mobile,+1 555-888-9999,,,
"Smith-Jones",,Alexandra,,,,,,,Mobile,+1 555-000-1111,,,`;

      const result = parseCSV(csv);

      expect(result.rows).toHaveLength(2);

      const firstNameIdx = result.headers.indexOf('First Name');
      expect(result.rows[0]?.[firstNameIdx]).toBe("O'Brien");
      expect(result.rows[1]?.[firstNameIdx]).toBe('Smith-Jones');
    });

    it('handles Google Contacts CSV with organization names containing commas', () => {
      const csv = `${googleContactsHeaders}
Grace,,Hopper,"Navy, United States",,,,,,,+1 555-222-3333,,,`;

      const result = parseCSV(csv);

      const orgIdx = result.headers.indexOf('Organization Name');
      expect(result.rows[0]?.[orgIdx]).toBe('Navy, United States');
    });

    it('handles Google Contacts CSV with empty optional fields', () => {
      const csv = `${googleContactsHeaders}
Henry,,,,,,,,,Mobile,+1 555-444-5555,,,`;

      const result = parseCSV(csv);

      expect(result.rows).toHaveLength(1);

      const row = result.rows[0];
      const firstNameIdx = result.headers.indexOf('First Name');
      const middleNameIdx = result.headers.indexOf('Middle Name');
      const lastNameIdx = result.headers.indexOf('Last Name');
      const orgIdx = result.headers.indexOf('Organization Name');

      expect(row?.[firstNameIdx]).toBe('Henry');
      expect(row?.[middleNameIdx]).toBe('');
      expect(row?.[lastNameIdx]).toBe('');
      expect(row?.[orgIdx]).toBe('');
    });
  });
});
