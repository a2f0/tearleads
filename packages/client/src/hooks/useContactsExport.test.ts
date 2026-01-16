import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useContactsExport } from './useContactsExport';

// Mock the file-utils module
const mockSaveFile = vi.fn().mockResolvedValue(undefined);
vi.mock('../lib/file-utils', () => ({
  saveFile: (data: Uint8Array, filename: string) => mockSaveFile(data, filename)
}));

// Mock the database module
const mockSelectFrom = vi.fn();
const mockSelectWhere = vi.fn();
const mockSelectOrderBy = vi.fn();
const mockSelectLimit = vi.fn();

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => ({
    select: () => ({
      from: mockSelectFrom
    })
  }))
}));

describe('useContactsExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock chain
    mockSelectFrom.mockReturnValue({
      where: mockSelectWhere,
      orderBy: mockSelectOrderBy
    });
    mockSelectWhere.mockReturnValue({
      limit: mockSelectLimit,
      orderBy: mockSelectOrderBy
    });
    mockSelectLimit.mockResolvedValue([]);
    mockSelectOrderBy.mockResolvedValue([]);
  });

  describe('exportContact', () => {
    it('exports a single contact to VCF file', async () => {
      const mockContact = {
        id: 'contact-123',
        firstName: 'John',
        lastName: 'Doe',
        birthday: '1990-01-15',
        deleted: false
      };
      const mockEmails = [
        {
          id: 'e1',
          contactId: 'contact-123',
          email: 'john@home.com',
          label: 'Home',
          isPrimary: true
        }
      ];
      const mockPhones = [
        {
          id: 'p1',
          contactId: 'contact-123',
          phoneNumber: '+1234567890',
          label: 'Mobile',
          isPrimary: true
        }
      ];

      // Setup mocks to return contact data
      mockSelectLimit.mockResolvedValue([mockContact]);
      mockSelectOrderBy
        .mockResolvedValueOnce(mockEmails)
        .mockResolvedValueOnce(mockPhones);

      const { result } = renderHook(() => useContactsExport());

      await act(async () => {
        await result.current.exportContact('contact-123');
      });

      expect(mockSaveFile).toHaveBeenCalledTimes(1);
      const call = mockSaveFile.mock.calls[0];
      expect(call).toBeDefined();
      const [data, filename] = call as [Uint8Array, string];

      // Check filename
      expect(filename).toBe('John Doe.vcf');

      // Decode the data and verify vCard content
      const vcardContent = new TextDecoder().decode(data);
      expect(vcardContent).toContain('BEGIN:VCARD');
      expect(vcardContent).toContain('VERSION:4.0');
      expect(vcardContent).toContain('FN:John Doe');
      expect(vcardContent).toContain('N:Doe;John;;;');
      expect(vcardContent).toContain('BDAY:19900115');
      expect(vcardContent).toContain('TEL;TYPE=cell;PREF=1:+1234567890');
      expect(vcardContent).toContain('EMAIL;TYPE=home;PREF=1:john@home.com');
      expect(vcardContent).toContain('END:VCARD');
    });

    it('throws error when contact not found', async () => {
      mockSelectLimit.mockResolvedValue([]);

      const { result } = renderHook(() => useContactsExport());

      await expect(
        act(async () => {
          await result.current.exportContact('non-existent');
        })
      ).rejects.toThrow('Contact not found');

      expect(mockSaveFile).not.toHaveBeenCalled();
    });

    it('exports contact with no emails or phones', async () => {
      const mockContact = {
        id: 'contact-456',
        firstName: 'Jane',
        lastName: null,
        birthday: null,
        deleted: false
      };

      mockSelectLimit.mockResolvedValue([mockContact]);
      mockSelectOrderBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

      const { result } = renderHook(() => useContactsExport());

      await act(async () => {
        await result.current.exportContact('contact-456');
      });

      expect(mockSaveFile).toHaveBeenCalledTimes(1);
      const call = mockSaveFile.mock.calls[0];
      expect(call).toBeDefined();
      const [data, filename] = call as [Uint8Array, string];

      expect(filename).toBe('Jane.vcf');

      const vcardContent = new TextDecoder().decode(data);
      expect(vcardContent).toContain('FN:Jane');
      expect(vcardContent).toContain('N:;Jane;;;');
      expect(vcardContent).not.toContain('TEL');
      expect(vcardContent).not.toContain('EMAIL');
    });

    it('sets exporting state during export', async () => {
      const mockContact = {
        id: 'contact-789',
        firstName: 'Test',
        lastName: null,
        birthday: null,
        deleted: false
      };

      mockSelectLimit.mockResolvedValue([mockContact]);
      mockSelectOrderBy.mockResolvedValue([]);

      const { result } = renderHook(() => useContactsExport());

      expect(result.current.exporting).toBe(false);

      const exportPromise = act(async () => {
        await result.current.exportContact('contact-789');
      });

      await exportPromise;

      expect(result.current.exporting).toBe(false);
    });

    it('resets exporting state even on error', async () => {
      mockSelectLimit.mockResolvedValue([]);

      const { result } = renderHook(() => useContactsExport());

      try {
        await act(async () => {
          await result.current.exportContact('non-existent');
        });
      } catch {
        // Expected to throw
      }

      expect(result.current.exporting).toBe(false);
    });
  });

  describe('exportAllContacts', () => {
    it('exports all non-deleted contacts to VCF file', async () => {
      const mockContacts = [
        {
          id: 'c1',
          firstName: 'Alice',
          lastName: 'Anderson',
          birthday: null,
          deleted: false
        },
        {
          id: 'c2',
          firstName: 'Bob',
          lastName: 'Brown',
          birthday: '1985-06-20',
          deleted: false
        }
      ];
      const mockEmails = [
        {
          id: 'e1',
          contactId: 'c1',
          email: 'alice@example.com',
          label: 'Work',
          isPrimary: true
        },
        {
          id: 'e2',
          contactId: 'c2',
          email: 'bob@example.com',
          label: 'Home',
          isPrimary: true
        }
      ];
      const mockPhones = [
        {
          id: 'p1',
          contactId: 'c2',
          phoneNumber: '+1111111111',
          label: 'Mobile',
          isPrimary: true
        }
      ];

      // First call returns contacts, subsequent calls return emails/phones
      mockSelectOrderBy
        .mockResolvedValueOnce(mockContacts)
        .mockResolvedValueOnce(mockEmails)
        .mockResolvedValueOnce(mockPhones);

      const { result } = renderHook(() => useContactsExport());

      await act(async () => {
        await result.current.exportAllContacts();
      });

      expect(mockSaveFile).toHaveBeenCalledTimes(1);
      const call = mockSaveFile.mock.calls[0];
      expect(call).toBeDefined();
      const [data, filename] = call as [Uint8Array, string];

      // Should have timestamp-based filename for multiple contacts
      expect(filename).toMatch(/^contacts-\d{4}-\d{2}-\d{2}\.vcf$/);

      const vcardContent = new TextDecoder().decode(data);
      expect(vcardContent).toContain('FN:Alice Anderson');
      expect(vcardContent).toContain('FN:Bob Brown');
      expect(vcardContent).toContain(
        'EMAIL;TYPE=work;PREF=1:alice@example.com'
      );
      expect(vcardContent).toContain('EMAIL;TYPE=home;PREF=1:bob@example.com');
      expect(vcardContent).toContain('TEL;TYPE=cell;PREF=1:+1111111111');
      expect(vcardContent).toContain('BDAY:19850620');
    });

    it('throws error when no contacts to export', async () => {
      mockSelectOrderBy.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useContactsExport());

      await expect(
        act(async () => {
          await result.current.exportAllContacts();
        })
      ).rejects.toThrow('No contacts to export');

      expect(mockSaveFile).not.toHaveBeenCalled();
    });

    it('handles contacts without emails or phones', async () => {
      const mockContacts = [
        {
          id: 'c1',
          firstName: 'Carol',
          lastName: null,
          birthday: null,
          deleted: false
        }
      ];

      mockSelectOrderBy
        .mockResolvedValueOnce(mockContacts)
        .mockResolvedValueOnce([]) // No emails
        .mockResolvedValueOnce([]); // No phones

      const { result } = renderHook(() => useContactsExport());

      await act(async () => {
        await result.current.exportAllContacts();
      });

      expect(mockSaveFile).toHaveBeenCalledTimes(1);
      const call = mockSaveFile.mock.calls[0];
      expect(call).toBeDefined();
      const [data] = call as [Uint8Array, string];

      const vcardContent = new TextDecoder().decode(data);
      expect(vcardContent).toContain('FN:Carol');
      expect(vcardContent).not.toContain('TEL');
      expect(vcardContent).not.toContain('EMAIL');
    });

    it('filters emails and phones to only include those for exported contacts', async () => {
      const mockContacts = [
        {
          id: 'c1',
          firstName: 'Dave',
          lastName: null,
          birthday: null,
          deleted: false
        }
      ];
      // Include emails/phones from a different contact that should be filtered
      const mockEmails = [
        {
          id: 'e1',
          contactId: 'c1',
          email: 'dave@example.com',
          label: null,
          isPrimary: true
        },
        {
          id: 'e2',
          contactId: 'other',
          email: 'other@example.com',
          label: null,
          isPrimary: true
        }
      ];
      const mockPhones = [
        {
          id: 'p1',
          contactId: 'other',
          phoneNumber: '+9999999999',
          label: null,
          isPrimary: true
        }
      ];

      mockSelectOrderBy
        .mockResolvedValueOnce(mockContacts)
        .mockResolvedValueOnce(mockEmails)
        .mockResolvedValueOnce(mockPhones);

      const { result } = renderHook(() => useContactsExport());

      await act(async () => {
        await result.current.exportAllContacts();
      });

      const call = mockSaveFile.mock.calls[0];
      expect(call).toBeDefined();
      const [data] = call as [Uint8Array, string];
      const vcardContent = new TextDecoder().decode(data);

      // Should only have Dave's email
      expect(vcardContent).toContain('EMAIL;PREF=1:dave@example.com');
      expect(vcardContent).not.toContain('other@example.com');
      expect(vcardContent).not.toContain('+9999999999');
    });

    it('sets exporting state during export', async () => {
      mockSelectOrderBy.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useContactsExport());

      expect(result.current.exporting).toBe(false);

      try {
        await act(async () => {
          await result.current.exportAllContacts();
        });
      } catch {
        // Expected to throw when no contacts
      }

      expect(result.current.exporting).toBe(false);
    });
  });
});
