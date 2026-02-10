import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContactsProvider,
  type ContactsProviderProps,
  type ContactsUIComponents
} from '../context';
import { useContactsImport } from './useContactsImport';

const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockDatabase = {
  insert: vi.fn().mockReturnValue({
    values: mockInsertValues
  })
};

const mockAdapter = {
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commitTransaction: vi.fn().mockResolvedValue(undefined),
  rollbackTransaction: vi.fn().mockResolvedValue(undefined)
};

const mockOnContactsImported = vi.fn().mockResolvedValue(undefined);

const mockUIComponents: ContactsUIComponents = {
  Button: ({ children }) => <button type="button">{children}</button>,
  Input: (props) => <input {...props} />,
  ContextMenu: ({ children }) => <div>{children}</div>,
  ContextMenuItem: ({ children }) => <div>{children}</div>,
  ListRow: ({ children }) => <div>{children}</div>,
  RefreshButton: () => <button type="button">Refresh</button>,
  VirtualListStatus: () => <div>Status</div>,
  InlineUnlock: () => <div>Unlock</div>,
  DropdownMenu: ({ children }) => <div>{children}</div>,
  DropdownMenuItem: ({ children }) => <div>{children}</div>,
  DropdownMenuSeparator: () => <div />,
  WindowOptionsMenuItem: () => <div />,
  AboutMenuItem: () => <div />,
  BackLink: () => <a href="#">Back</a>,
  Dropzone: () => <div>Dropzone</div>
};

function createWrapper(
  overrides: Partial<ContactsProviderProps> = {}
): ({ children }: { children: ReactNode }) => ReactNode {
  const defaultProps: ContactsProviderProps = {
    children: null,
    databaseState: {
      isUnlocked: true,
      isLoading: false,
      currentInstanceId: 'test-instance'
    },
    getDatabase: () => mockDatabase as never,
    getDatabaseAdapter: () => mockAdapter,
    saveFile: vi.fn(),
    registerInVfs: vi.fn().mockResolvedValue({ success: true }),
    onContactsImported: mockOnContactsImported,
    ui: mockUIComponents,
    t: (key) => key,
    navigate: vi.fn(),
    navigateWithFrom: vi.fn(),
    formatDate: (date) => date.toISOString()
  };

  return ({ children }) => (
    <ContactsProvider {...defaultProps} {...overrides}>
      {children}
    </ContactsProvider>
  );
}

describe('useContactsImport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls onContactsImported with imported contact data after CSV import', async () => {
    const wrapper = createWrapper();
    const { result } = renderHook(() => useContactsImport(), { wrapper });

    const parsedData = {
      headers: ['FirstName', 'LastName', 'Email', 'Phone'],
      rows: [['Alice', 'Johnson', 'alice@example.com', '555-1234']]
    };

    const mapping = {
      firstName: 0,
      lastName: 1,
      email1Label: null,
      email1Value: 2,
      email2Label: null,
      email2Value: null,
      phone1Label: null,
      phone1Value: 3,
      phone2Label: null,
      phone2Value: null,
      phone3Label: null,
      phone3Value: null,
      birthday: null
    };

    await act(async () => {
      const importResult = await result.current.importContacts(
        parsedData,
        mapping
      );
      expect(importResult.imported).toBe(1);
      expect(importResult.skipped).toBe(0);
      expect(importResult.errors).toHaveLength(0);
    });

    expect(mockOnContactsImported).toHaveBeenCalledTimes(1);
    expect(mockOnContactsImported).toHaveBeenCalledWith([
      expect.objectContaining({
        firstName: 'Alice',
        lastName: 'Johnson',
        email: 'alice@example.com',
        phone: '555-1234'
      })
    ]);
  });
});
