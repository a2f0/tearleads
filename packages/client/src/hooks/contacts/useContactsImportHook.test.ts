import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ColumnMapping,
  ImportResult,
  ParsedCSV
} from './useContactsImport';
import { useContactsImport } from './useContactsImport';

// Mock the database module
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue(undefined)
});
const mockCreateContactDocument = vi.fn(
  (
    id: string,
    firstName: string,
    lastName: string | null,
    email?: string | null,
    phone?: string | null,
    createdAt?: number,
    updatedAt?: number
  ) => ({
    id,
    entityType: 'contact' as const,
    title: [firstName, lastName].filter(Boolean).join(' ') || 'Unknown',
    ...(email && { metadata: email }),
    ...(phone && { content: phone }),
    createdAt: createdAt ?? 0,
    updatedAt: updatedAt ?? 0
  })
);
const mockIndexDocuments = vi.fn().mockResolvedValue(undefined);

vi.mock('@/db', () => ({
  getDatabase: vi.fn(() => ({
    insert: mockInsert
  })),
  getCurrentInstanceId: vi.fn(() => 'test-instance'),
  getDatabaseAdapter: vi.fn(() => ({
    beginTransaction: vi.fn().mockResolvedValue(undefined),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    rollbackTransaction: vi.fn().mockResolvedValue(undefined)
  }))
}));

vi.mock('@/contexts/OrgContext', () => ({
  useOrg: () => ({
    activeOrganizationId: null,
    organizations: [],
    setActiveOrganizationId: vi.fn(),
    isLoading: false
  })
}));

vi.mock('@/search', () => ({
  createContactDocument: (
    id: string,
    firstName: string,
    lastName: string | null,
    email?: string | null,
    phone?: string | null,
    createdAt?: number,
    updatedAt?: number
  ) =>
    mockCreateContactDocument(
      id,
      firstName,
      lastName,
      email,
      phone,
      createdAt,
      updatedAt
    ),
  indexDocuments: (instanceId: string, docs: unknown[]) =>
    mockIndexDocuments(instanceId, docs)
}));

describe('useContactsImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseFile', () => {
    it('parses a file and returns parsed CSV data', async () => {
      const csvContent = 'Name,Age\nAlice,25\nBob,30';
      // Create a File with text() method polyfill for jsdom
      const file = new File([csvContent], 'test.csv', { type: 'text/csv' });
      // Polyfill text() for jsdom
      file.text = () => Promise.resolve(csvContent);

      const { result } = renderHook(() => useContactsImport());

      let parsedData: ParsedCSV | undefined;
      await act(async () => {
        parsedData = await result.current.parseFile(file);
      });

      expect(parsedData).toBeDefined();
      expect(parsedData?.headers).toEqual(['Name', 'Age']);
      expect(parsedData?.rows).toHaveLength(2);
    });
  });

  describe('importContacts', () => {
    const createMapping = (
      overrides: Partial<ColumnMapping> = {}
    ): ColumnMapping => ({
      firstName: null,
      lastName: null,
      email1Label: null,
      email1Value: null,
      email2Label: null,
      email2Value: null,
      phone1Label: null,
      phone1Value: null,
      phone2Label: null,
      phone2Value: null,
      phone3Label: null,
      phone3Value: null,
      birthday: null,
      ...overrides
    });

    // Helper to run import and return results
    async function runImport(
      hook: { result: { current: ReturnType<typeof useContactsImport> } },
      data: ParsedCSV,
      mapping: ColumnMapping
    ): Promise<ImportResult> {
      let importResult: ImportResult | null = null;
      await act(async () => {
        importResult = await hook.result.current.importContacts(data, mapping);
      });
      if (!importResult) {
        throw new Error('importResult was not set');
      }
      return importResult;
    }

    it('returns error when firstName mapping is null', async () => {
      const data: ParsedCSV = {
        headers: ['Name', 'Age'],
        rows: [['Alice', '25']]
      };
      const mapping = createMapping({ firstName: null });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.errors).toContain('First Name column must be mapped');
      expect(importResult.imported).toBe(0);
    });

    it('skips rows with empty firstName', async () => {
      const data: ParsedCSV = {
        headers: ['FirstName', 'LastName'],
        rows: [
          ['', 'Doe'], // Should be skipped
          ['John', 'Smith'] // Should be imported
        ]
      };
      const mapping = createMapping({ firstName: 0, lastName: 1 });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.skipped).toBe(1);
      expect(importResult.imported).toBe(1);
    });

    it('imports contacts with emails and phones', async () => {
      const data: ParsedCSV = {
        headers: [
          'FirstName',
          'LastName',
          'Email1Label',
          'Email1',
          'Phone1Label',
          'Phone1'
        ],
        rows: [
          ['Alice', 'Johnson', 'Work', 'alice@work.com', 'Mobile', '555-1234']
        ]
      };
      const mapping = createMapping({
        firstName: 0,
        lastName: 1,
        email1Label: 2,
        email1Value: 3,
        phone1Label: 4,
        phone1Value: 5
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.imported).toBe(1);
      expect(importResult.skipped).toBe(0);
      expect(importResult.errors).toHaveLength(0);
    });

    it('indexes imported contacts for search after CSV import', async () => {
      const data: ParsedCSV = {
        headers: ['FirstName', 'LastName', 'Email1', 'Phone1'],
        rows: [['Alice', 'Johnson', 'alice@example.com', '555-1234']]
      };
      const mapping = createMapping({
        firstName: 0,
        lastName: 1,
        email1Value: 2,
        phone1Value: 3
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.imported).toBe(1);
      expect(mockCreateContactDocument).toHaveBeenCalledTimes(1);
      expect(mockCreateContactDocument).toHaveBeenCalledWith(
        expect.any(String),
        'Alice',
        'Johnson',
        'alice@example.com',
        '555-1234',
        expect.any(Number),
        expect.any(Number)
      );
      expect(mockIndexDocuments).toHaveBeenCalledTimes(1);
      expect(mockIndexDocuments).toHaveBeenCalledWith('test-instance', [
        expect.objectContaining({
          entityType: 'contact',
          title: 'Alice Johnson'
        })
      ]);
    });

    it('imports contacts with birthday', async () => {
      const data: ParsedCSV = {
        headers: ['FirstName', 'Birthday'],
        rows: [['Bob', '1990-05-15']]
      };
      const mapping = createMapping({
        firstName: 0,
        birthday: 1
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.imported).toBe(1);
    });

    it('imports contacts with multiple emails', async () => {
      const data: ParsedCSV = {
        headers: [
          'FirstName',
          'Email1Label',
          'Email1',
          'Email2Label',
          'Email2'
        ],
        rows: [
          ['Carol', 'Work', 'carol@work.com', 'Personal', 'carol@home.com']
        ]
      };
      const mapping = createMapping({
        firstName: 0,
        email1Label: 1,
        email1Value: 2,
        email2Label: 3,
        email2Value: 4
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.imported).toBe(1);
    });

    it('imports contacts with multiple phones', async () => {
      const data: ParsedCSV = {
        headers: [
          'FirstName',
          'Phone1Label',
          'Phone1',
          'Phone2Label',
          'Phone2',
          'Phone3Label',
          'Phone3'
        ],
        rows: [
          ['Dave', 'Mobile', '555-1111', 'Work', '555-2222', 'Home', '555-3333']
        ]
      };
      const mapping = createMapping({
        firstName: 0,
        phone1Label: 1,
        phone1Value: 2,
        phone2Label: 3,
        phone2Value: 4,
        phone3Label: 5,
        phone3Value: 6
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.imported).toBe(1);
    });

    it('updates progress during import', async () => {
      const data: ParsedCSV = {
        headers: ['FirstName'],
        rows: [['Alice'], ['Bob'], ['Carol']]
      };
      const mapping = createMapping({ firstName: 0 });

      const { result } = renderHook(() => useContactsImport());

      expect(result.current.progress).toBe(0);
      expect(result.current.importing).toBe(false);

      await act(async () => {
        await result.current.importContacts(data, mapping);
      });

      // After import completes, importing should be false and progress 100
      expect(result.current.importing).toBe(false);
      expect(result.current.progress).toBe(100);
    });

    it('handles emails without labels', async () => {
      const data: ParsedCSV = {
        headers: ['FirstName', 'Email1'],
        rows: [['Eve', 'eve@example.com']]
      };
      const mapping = createMapping({
        firstName: 0,
        email1Value: 1
        // email1Label is null
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.imported).toBe(1);
    });

    it('skips empty email values', async () => {
      const data: ParsedCSV = {
        headers: ['FirstName', 'Email1Label', 'Email1'],
        rows: [['Frank', 'Work', '']] // Empty email value
      };
      const mapping = createMapping({
        firstName: 0,
        email1Label: 1,
        email1Value: 2
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      // Contact should still be imported, just without email
      expect(importResult.imported).toBe(1);
    });

    it('handles null lastName mapping', async () => {
      const data: ParsedCSV = {
        headers: ['FirstName'],
        rows: [['Grace']]
      };
      const mapping = createMapping({
        firstName: 0,
        lastName: null
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.imported).toBe(1);
    });

    it('handles empty lastName value', async () => {
      const data: ParsedCSV = {
        headers: ['FirstName', 'LastName'],
        rows: [['Henry', '']] // Empty lastName
      };
      const mapping = createMapping({
        firstName: 0,
        lastName: 1
      });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.imported).toBe(1);
    });

    it('handles database insert errors and rolls back transaction', async () => {
      // Mock insert to throw an error
      const { getDatabase, getDatabaseAdapter } = await import('@/db');
      const mockAdapter = {
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        commitTransaction: vi.fn().mockResolvedValue(undefined),
        rollbackTransaction: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(getDatabaseAdapter).mockReturnValue(
        mockAdapter as unknown as ReturnType<typeof getDatabaseAdapter>
      );

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockRejectedValue(new Error('Database insert failed'))
        })
      };
      vi.mocked(getDatabase).mockReturnValue(
        mockDb as unknown as ReturnType<typeof getDatabase>
      );

      const data: ParsedCSV = {
        headers: ['FirstName'],
        rows: [['FailingContact']]
      };
      const mapping = createMapping({ firstName: 0 });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.skipped).toBe(1);
      expect(importResult.errors).toHaveLength(1);
      expect(importResult.errors[0]).toContain(
        'Failed to import FailingContact'
      );
      expect(mockAdapter.rollbackTransaction).toHaveBeenCalled();
    });

    it('handles non-Error exceptions during import', async () => {
      // Mock insert to throw a non-Error
      const { getDatabase, getDatabaseAdapter } = await import('@/db');
      const mockAdapter = {
        beginTransaction: vi.fn().mockResolvedValue(undefined),
        commitTransaction: vi.fn().mockResolvedValue(undefined),
        rollbackTransaction: vi.fn().mockResolvedValue(undefined)
      };
      vi.mocked(getDatabaseAdapter).mockReturnValue(
        mockAdapter as unknown as ReturnType<typeof getDatabaseAdapter>
      );

      const mockDb = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockRejectedValue('String error thrown')
        })
      };
      vi.mocked(getDatabase).mockReturnValue(
        mockDb as unknown as ReturnType<typeof getDatabase>
      );

      const data: ParsedCSV = {
        headers: ['FirstName'],
        rows: [['TestContact']]
      };
      const mapping = createMapping({ firstName: 0 });
      const hook = renderHook(() => useContactsImport());

      const importResult = await runImport(hook, data, mapping);

      expect(importResult.skipped).toBe(1);
      expect(importResult.errors[0]).toContain('Unknown error');
      expect(mockAdapter.rollbackTransaction).toHaveBeenCalled();
    });
  });
});
