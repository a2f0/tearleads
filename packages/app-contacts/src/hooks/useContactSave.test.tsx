import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ContactsProvider,
  type ContactsProviderProps,
  type ContactsUIComponents
} from '../context';
import { useContactSave } from './useContactSave';

// Mock database operations
const mockInsert = vi.fn().mockReturnValue({
  values: vi.fn().mockResolvedValue(undefined)
});

const mockDatabase = {
  insert: mockInsert
};

const mockAdapter = {
  beginTransaction: vi.fn().mockResolvedValue(undefined),
  commitTransaction: vi.fn().mockResolvedValue(undefined),
  rollbackTransaction: vi.fn().mockResolvedValue(undefined)
};

// Mock VFS registration
const mockRegisterInVfs = vi.fn().mockResolvedValue({ success: true });

// Minimal UI components for testing
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
    registerInVfs: mockRegisterInVfs,
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

describe('useContactSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createContact', () => {
    it('should create a contact and register it in VFS', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useContactSave(), { wrapper });

      let createResult:
        | Awaited<ReturnType<typeof result.current.createContact>>
        | undefined;
      await act(async () => {
        createResult = await result.current.createContact({
          formData: {
            firstName: 'John',
            lastName: 'Doe',
            birthday: '1990-01-15'
          },
          emails: [],
          phones: []
        });
      });

      expect(createResult?.success).toBe(true);
      expect(createResult?.contactId).toBeDefined();

      // Verify transaction was used
      expect(mockAdapter.beginTransaction).toHaveBeenCalled();
      expect(mockAdapter.commitTransaction).toHaveBeenCalled();

      // Verify VFS registration was called after commit
      expect(mockRegisterInVfs).toHaveBeenCalledWith(
        createResult?.contactId,
        expect.any(Date)
      );
    });

    it('should set organizationId on the inserted contact', async () => {
      const mockValues = vi.fn().mockResolvedValue(undefined);
      const orgInsert = vi.fn().mockReturnValue({ values: mockValues });
      const orgDatabase = { insert: orgInsert };

      const wrapper = createWrapper({
        getDatabase: () => orgDatabase as never,
        activeOrganizationId: 'test-org-123'
      });
      const { result } = renderHook(() => useContactSave(), { wrapper });

      await act(async () => {
        await result.current.createContact({
          formData: {
            firstName: 'Org',
            lastName: 'User',
            birthday: ''
          },
          emails: [],
          phones: []
        });
      });

      // The first insert call should be for the contact
      const firstValues = mockValues.mock.calls[0]?.[0];
      expect(firstValues).toEqual(
        expect.objectContaining({ organizationId: 'test-org-123' })
      );
    });

    it('should create a contact with emails and phones', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useContactSave(), { wrapper });

      let createResult:
        | Awaited<ReturnType<typeof result.current.createContact>>
        | undefined;
      await act(async () => {
        createResult = await result.current.createContact({
          formData: {
            firstName: 'Jane',
            lastName: 'Smith',
            birthday: ''
          },
          emails: [
            {
              id: 'email-1',
              email: 'jane@example.com',
              label: 'Work',
              isPrimary: true
            }
          ],
          phones: [
            {
              id: 'phone-1',
              phoneNumber: '555-1234',
              label: 'Mobile',
              isPrimary: true
            }
          ]
        });
      });

      expect(createResult?.success).toBe(true);

      // Should have multiple insert calls: contacts, emails, phones
      expect(mockInsert).toHaveBeenCalledTimes(3);

      // VFS registration should be called
      expect(mockRegisterInVfs).toHaveBeenCalled();
    });

    it('should still succeed if VFS registration fails', async () => {
      const failingRegisterInVfs = vi.fn().mockResolvedValue({
        success: false,
        error: 'VFS registration failed'
      });

      const wrapper = createWrapper({ registerInVfs: failingRegisterInVfs });
      const { result } = renderHook(() => useContactSave(), { wrapper });

      // Suppress console.warn for this test
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      let createResult:
        | Awaited<ReturnType<typeof result.current.createContact>>
        | undefined;
      await act(async () => {
        createResult = await result.current.createContact({
          formData: {
            firstName: 'Test',
            lastName: 'User',
            birthday: ''
          },
          emails: [],
          phones: []
        });
      });

      // Contact creation should still succeed
      expect(createResult?.success).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(
        'VFS registration failed:',
        'VFS registration failed'
      );

      warnSpy.mockRestore();
    });

    it('should rollback transaction on database error', async () => {
      const failingInsert = vi.fn().mockReturnValue({
        values: vi.fn().mockRejectedValue(new Error('Database error'))
      });

      const failingDatabase = {
        insert: failingInsert
      };

      // Suppress console.error for this test
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const wrapper = createWrapper({
        getDatabase: () => failingDatabase as never
      });
      const { result } = renderHook(() => useContactSave(), { wrapper });

      let createResult:
        | Awaited<ReturnType<typeof result.current.createContact>>
        | undefined;
      await act(async () => {
        createResult = await result.current.createContact({
          formData: {
            firstName: 'Test',
            lastName: 'User',
            birthday: ''
          },
          emails: [],
          phones: []
        });
      });

      expect(createResult?.success).toBe(false);
      expect(createResult?.error).toBe('Database error');
      expect(mockAdapter.rollbackTransaction).toHaveBeenCalled();

      // VFS registration should NOT be called on failure
      expect(mockRegisterInVfs).not.toHaveBeenCalled();

      errorSpy.mockRestore();
    });

    it('should set saving state during operation', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useContactSave(), { wrapper });

      expect(result.current.saving).toBe(false);

      await act(async () => {
        await result.current.createContact({
          formData: {
            firstName: 'Test',
            lastName: '',
            birthday: ''
          },
          emails: [],
          phones: []
        });
      });

      await waitFor(() => {
        expect(result.current.saving).toBe(false);
      });
    });
  });

  describe('updateContact', () => {
    it('should update an existing contact', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue(undefined)
        })
      });

      const mockDelete = vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue(undefined)
      });

      const updateDatabase = {
        insert: mockInsert,
        update: mockUpdate,
        delete: mockDelete
      };

      const wrapper = createWrapper({
        getDatabase: () => updateDatabase as never
      });
      const { result } = renderHook(() => useContactSave(), { wrapper });

      let updateResult:
        | Awaited<ReturnType<typeof result.current.updateContact>>
        | undefined;
      await act(async () => {
        updateResult = await result.current.updateContact({
          contactId: 'existing-contact-id',
          formData: {
            firstName: 'Updated',
            lastName: 'Name',
            birthday: ''
          },
          emails: [],
          phones: []
        });
      });

      expect(updateResult?.success).toBe(true);
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should return error if contactId is missing', async () => {
      const wrapper = createWrapper();
      const { result } = renderHook(() => useContactSave(), { wrapper });

      const updateResult = await result.current.updateContact({
        formData: {
          firstName: 'Test',
          lastName: '',
          birthday: ''
        },
        emails: [],
        phones: []
      });

      expect(updateResult.success).toBe(false);
      expect(updateResult.error).toBe('Contact ID is required for update');
    });
  });
});
