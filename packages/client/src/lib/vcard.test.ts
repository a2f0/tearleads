import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  escapeValue,
  generateVCard,
  generateVCardFilename,
  generateVCards,
  mapLabelToType,
  type VCardContact
} from './vcard';

describe('vcard', () => {
  describe('escapeValue', () => {
    it('escapes backslashes', () => {
      expect(escapeValue('path\\to\\file')).toBe('path\\\\to\\\\file');
    });

    it('escapes semicolons', () => {
      expect(escapeValue('a;b;c')).toBe('a\\;b\\;c');
    });

    it('escapes commas', () => {
      expect(escapeValue('a,b,c')).toBe('a\\,b\\,c');
    });

    it('escapes multiple special characters', () => {
      expect(escapeValue('a\\b;c,d')).toBe('a\\\\b\\;c\\,d');
    });

    it('returns unchanged string if no special characters', () => {
      expect(escapeValue('John Doe')).toBe('John Doe');
    });

    it('handles empty string', () => {
      expect(escapeValue('')).toBe('');
    });
  });

  describe('mapLabelToType', () => {
    it('maps Work to work', () => {
      expect(mapLabelToType('Work')).toBe('work');
    });

    it('maps Home to home', () => {
      expect(mapLabelToType('Home')).toBe('home');
    });

    it('maps Mobile to cell', () => {
      expect(mapLabelToType('Mobile')).toBe('cell');
    });

    it('maps cell to cell', () => {
      expect(mapLabelToType('cell')).toBe('cell');
    });

    it('maps Main to voice', () => {
      expect(mapLabelToType('Main')).toBe('voice');
    });

    it('maps Fax to fax', () => {
      expect(mapLabelToType('Fax')).toBe('fax');
    });

    it('maps Pager to pager', () => {
      expect(mapLabelToType('Pager')).toBe('pager');
    });

    it('returns null for Other', () => {
      expect(mapLabelToType('Other')).toBeNull();
    });

    it('returns null for unknown labels', () => {
      expect(mapLabelToType('Unknown')).toBeNull();
    });

    it('returns null for null input', () => {
      expect(mapLabelToType(null)).toBeNull();
    });

    it('handles case insensitivity', () => {
      expect(mapLabelToType('WORK')).toBe('work');
      expect(mapLabelToType('work')).toBe('work');
      expect(mapLabelToType('WoRk')).toBe('work');
    });

    it('trims whitespace', () => {
      expect(mapLabelToType('  Work  ')).toBe('work');
    });
  });

  describe('generateVCard', () => {
    it('generates basic vCard with required fields', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: null,
        birthday: null,
        emails: [],
        phones: []
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('BEGIN:VCARD');
      expect(vcard).toContain('VERSION:4.0');
      expect(vcard).toContain('FN:John');
      expect(vcard).toContain('N:;John;;;');
      expect(vcard).toContain('END:VCARD');
    });

    it('includes last name in FN and N fields', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: 'Doe',
        birthday: null,
        emails: [],
        phones: []
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('FN:John Doe');
      expect(vcard).toContain('N:Doe;John;;;');
    });

    it('includes birthday in YYYYMMDD format', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: 'Doe',
        birthday: '1990-01-15',
        emails: [],
        phones: []
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('BDAY:19900115');
    });

    it('handles birthday without dashes', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: 'Doe',
        birthday: '19900115',
        emails: [],
        phones: []
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('BDAY:19900115');
    });

    it('includes phone numbers with TYPE', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: null,
        birthday: null,
        emails: [],
        phones: [
          { phoneNumber: '+1234567890', label: 'Mobile', isPrimary: false }
        ]
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('TEL;TYPE=cell:+1234567890');
    });

    it('includes phone numbers with PREF for primary', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: null,
        birthday: null,
        emails: [],
        phones: [
          { phoneNumber: '+1234567890', label: 'Mobile', isPrimary: true }
        ]
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('TEL;TYPE=cell;PREF=1:+1234567890');
    });

    it('includes phone numbers without TYPE for unknown label', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: null,
        birthday: null,
        emails: [],
        phones: [
          { phoneNumber: '+1234567890', label: 'Other', isPrimary: true }
        ]
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('TEL;PREF=1:+1234567890');
    });

    it('includes email addresses with TYPE', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: null,
        birthday: null,
        emails: [{ email: 'john@work.com', label: 'Work', isPrimary: false }],
        phones: []
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('EMAIL;TYPE=work:john@work.com');
    });

    it('includes email addresses with PREF for primary', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: null,
        birthday: null,
        emails: [{ email: 'john@home.com', label: 'Home', isPrimary: true }],
        phones: []
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('EMAIL;TYPE=home;PREF=1:john@home.com');
    });

    it('generates complete vCard with all fields', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: 'Doe',
        birthday: '1990-01-15',
        emails: [
          { email: 'john@home.com', label: 'Home', isPrimary: true },
          { email: 'john@work.com', label: 'Work', isPrimary: false }
        ],
        phones: [
          { phoneNumber: '+1234567890', label: 'Mobile', isPrimary: true },
          { phoneNumber: '+0987654321', label: 'Work', isPrimary: false }
        ]
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('BEGIN:VCARD');
      expect(vcard).toContain('VERSION:4.0');
      expect(vcard).toContain('FN:John Doe');
      expect(vcard).toContain('N:Doe;John;;;');
      expect(vcard).toContain('BDAY:19900115');
      expect(vcard).toContain('TEL;TYPE=cell;PREF=1:+1234567890');
      expect(vcard).toContain('TEL;TYPE=work:+0987654321');
      expect(vcard).toContain('EMAIL;TYPE=home;PREF=1:john@home.com');
      expect(vcard).toContain('EMAIL;TYPE=work:john@work.com');
      expect(vcard).toContain('END:VCARD');
    });

    it('escapes special characters in names', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John;Jr',
        lastName: 'O,Brien',
        birthday: null,
        emails: [],
        phones: []
      };

      const vcard = generateVCard(contact);

      expect(vcard).toContain('FN:John\\;Jr O\\,Brien');
      expect(vcard).toContain('N:O\\,Brien;John\\;Jr;;;');
    });

    it('uses CRLF line endings', () => {
      const contact: VCardContact = {
        id: '123',
        firstName: 'John',
        lastName: null,
        birthday: null,
        emails: [],
        phones: []
      };

      const vcard = generateVCard(contact);

      expect(vcard).toMatch(/BEGIN:VCARD\r\n/);
      expect(vcard).toMatch(/\r\nEND:VCARD$/);
    });
  });

  describe('generateVCards', () => {
    it('concatenates multiple vCards', () => {
      const contacts: VCardContact[] = [
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          emails: [],
          phones: []
        },
        {
          id: '2',
          firstName: 'Jane',
          lastName: 'Smith',
          birthday: null,
          emails: [],
          phones: []
        }
      ];

      const vcards = generateVCards(contacts);

      expect(vcards).toContain('FN:John Doe');
      expect(vcards).toContain('FN:Jane Smith');
      expect((vcards.match(/BEGIN:VCARD/g) ?? []).length).toBe(2);
      expect((vcards.match(/END:VCARD/g) ?? []).length).toBe(2);
    });

    it('handles empty array', () => {
      const vcards = generateVCards([]);

      expect(vcards).toBe('');
    });

    it('handles single contact', () => {
      const contacts: VCardContact[] = [
        {
          id: '1',
          firstName: 'John',
          lastName: null,
          birthday: null,
          emails: [],
          phones: []
        }
      ];

      const vcards = generateVCards(contacts);

      expect((vcards.match(/BEGIN:VCARD/g) ?? []).length).toBe(1);
      expect((vcards.match(/END:VCARD/g) ?? []).length).toBe(1);
    });
  });

  describe('generateVCardFilename', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('generates filename from single contact name', () => {
      const contacts: VCardContact[] = [
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          emails: [],
          phones: []
        }
      ];

      const filename = generateVCardFilename(contacts);

      expect(filename).toBe('John Doe.vcf');
    });

    it('generates filename from single contact first name only', () => {
      const contacts: VCardContact[] = [
        {
          id: '1',
          firstName: 'John',
          lastName: null,
          birthday: null,
          emails: [],
          phones: []
        }
      ];

      const filename = generateVCardFilename(contacts);

      expect(filename).toBe('John.vcf');
    });

    it('removes unsafe filename characters', () => {
      const contacts: VCardContact[] = [
        {
          id: '1',
          firstName: 'John/Jane',
          lastName: 'Doe:Jr',
          birthday: null,
          emails: [],
          phones: []
        }
      ];

      const filename = generateVCardFilename(contacts);

      expect(filename).toBe('JohnJane DoeJr.vcf');
    });

    it('generates timestamp filename for multiple contacts', () => {
      vi.setSystemTime(new Date('2025-03-15T14:30:45'));

      const contacts: VCardContact[] = [
        {
          id: '1',
          firstName: 'John',
          lastName: 'Doe',
          birthday: null,
          emails: [],
          phones: []
        },
        {
          id: '2',
          firstName: 'Jane',
          lastName: 'Smith',
          birthday: null,
          emails: [],
          phones: []
        }
      ];

      const filename = generateVCardFilename(contacts);

      expect(filename).toBe('contacts-2025-03-15.vcf');
    });

    it('generates timestamp filename for empty array', () => {
      vi.setSystemTime(new Date('2025-01-05T09:05:03'));

      const filename = generateVCardFilename([]);

      expect(filename).toBe('contacts-2025-01-05.vcf');
    });

    it('pads single digit months and days', () => {
      vi.setSystemTime(new Date('2025-01-05T12:00:00'));

      const filename = generateVCardFilename([]);

      expect(filename).toBe('contacts-2025-01-05.vcf');
    });
  });
});
