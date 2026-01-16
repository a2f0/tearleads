import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyStatus } from '@/db/crypto/key-manager';
import type { InstanceMetadata } from '@/db/instance-registry';
import { mockConsoleError } from '@/test/console-mocks';
import { KeychainDetail } from './KeychainDetail';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate
  };
});

const mockGetKeyStatusForInstance =
  vi.fn<(instanceId: string) => Promise<KeyStatus>>();
const mockDeleteSessionKeysForInstance =
  vi.fn<(instanceId: string) => Promise<void>>();
const mockKeyManagerReset = vi.fn<() => Promise<void>>();
const mockGetKeyManagerForInstance = vi.fn((_instanceId: string) => ({
  reset: mockKeyManagerReset
}));

vi.mock('@/db/crypto/key-manager', () => ({
  getKeyStatusForInstance: (instanceId: string) =>
    mockGetKeyStatusForInstance(instanceId),
  deleteSessionKeysForInstance: (instanceId: string) =>
    mockDeleteSessionKeysForInstance(instanceId),
  getKeyManagerForInstance: (instanceId: string) =>
    mockGetKeyManagerForInstance(instanceId)
}));

const mockGetInstances = vi.fn<() => Promise<InstanceMetadata[]>>();
const mockDeleteInstanceFromRegistry =
  vi.fn<(instanceId: string) => Promise<void>>();

vi.mock('@/db/instance-registry', () => ({
  getInstances: () => mockGetInstances(),
  deleteInstanceFromRegistry: (instanceId: string) =>
    mockDeleteInstanceFromRegistry(instanceId)
}));

function renderKeychainDetail(instanceId: string) {
  return render(
    <MemoryRouter initialEntries={[`/keychain/${instanceId}`]}>
      <Routes>
        <Route path="/keychain/:id" element={<KeychainDetail />} />
      </Routes>
    </MemoryRouter>
  );
}

function createInstance(
  id: string,
  name: string,
  createdAt = Date.now(),
  lastAccessedAt = Date.now()
): InstanceMetadata {
  return { id, name, createdAt, lastAccessedAt };
}

function createKeyStatus(
  salt = false,
  keyCheckValue = false,
  wrappingKey = false,
  wrappedKey = false
): KeyStatus {
  return { salt, keyCheckValue, wrappingKey, wrappedKey };
}

describe('KeychainDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstances.mockResolvedValue([]);
    mockGetKeyStatusForInstance.mockResolvedValue(createKeyStatus());
    mockDeleteSessionKeysForInstance.mockResolvedValue(undefined);
    mockKeyManagerReset.mockResolvedValue(undefined);
    mockDeleteInstanceFromRegistry.mockResolvedValue(undefined);
  });

  describe('loading state', () => {
    it('shows loading state initially', async () => {
      mockGetInstances.mockImplementation(() => new Promise(() => {}));

      renderKeychainDetail('test-id');

      expect(screen.getByText('Loading instance...')).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('shows error when instance not found', async () => {
      mockGetInstances.mockResolvedValue([]);

      renderKeychainDetail('non-existent');

      await waitFor(() => {
        expect(screen.getByText('Instance not found')).toBeInTheDocument();
      });
    });

    it('shows error when fetch fails', async () => {
      const consoleSpy = mockConsoleError();
      mockGetInstances.mockRejectedValue(new Error('Network error'));

      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch instance info:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('shows error when fetch fails with non-Error', async () => {
      const consoleSpy = mockConsoleError();
      mockGetInstances.mockRejectedValue('String error');

      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('String error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch instance info:',
        'String error'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('with instance data', () => {
    const testInstance = createInstance(
      'test-instance-id',
      'Test Instance',
      1704067200000,
      1704153600000
    );

    beforeEach(() => {
      mockGetInstances.mockResolvedValue([testInstance]);
      mockGetKeyStatusForInstance.mockResolvedValue(
        createKeyStatus(true, true, true, true)
      );
    });

    it('displays instance name', async () => {
      renderKeychainDetail('test-instance-id');

      await waitFor(() => {
        expect(screen.getByText('Test Instance')).toBeInTheDocument();
      });
    });

    it('displays full instance ID', async () => {
      renderKeychainDetail('test-instance-id');

      await waitFor(() => {
        expect(screen.getByText('test-instance-id')).toBeInTheDocument();
      });
    });

    it('displays key status indicators', async () => {
      renderKeychainDetail('test-instance-id');

      await waitFor(() => {
        expect(screen.getByText('Salt')).toBeInTheDocument();
        expect(screen.getByText('Key Check Value')).toBeInTheDocument();
        expect(screen.getByText('Session Wrapping Key')).toBeInTheDocument();
        expect(screen.getByText('Session Wrapped Key')).toBeInTheDocument();
      });
    });

    it('displays timestamps', async () => {
      renderKeychainDetail('test-instance-id');

      await waitFor(() => {
        expect(screen.getByText('Created')).toBeInTheDocument();
        expect(screen.getByText('Last Accessed')).toBeInTheDocument();
      });
    });

    it('shows delete session keys button when session keys exist', async () => {
      renderKeychainDetail('test-instance-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
      });
    });

    it('shows delete instance button', async () => {
      renderKeychainDetail('test-instance-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Instance')).toBeInTheDocument();
      });
    });
  });

  describe('without session keys', () => {
    beforeEach(() => {
      mockGetInstances.mockResolvedValue([
        createInstance('no-session', 'No Session')
      ]);
      mockGetKeyStatusForInstance.mockResolvedValue(
        createKeyStatus(true, true, false, false)
      );
    });

    it('hides delete session keys button when no session keys', async () => {
      renderKeychainDetail('no-session');

      await waitFor(() => {
        expect(screen.getByText('No Session')).toBeInTheDocument();
      });

      expect(screen.queryByText('Delete Session Keys')).not.toBeInTheDocument();
    });
  });

  describe('delete functionality', () => {
    const testInstance = createInstance('test-id', 'Test Instance');

    beforeEach(() => {
      mockGetInstances.mockResolvedValue([testInstance]);
      mockGetKeyStatusForInstance.mockResolvedValue(
        createKeyStatus(true, true, true, true)
      );
    });

    it('shows confirmation when deleting session keys', async () => {
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Session Keys'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
        expect(
          screen.getByText(/Are you sure you want to delete session keys/)
        ).toBeInTheDocument();
      });
    });

    it('deletes session keys when confirmed', async () => {
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Session Keys'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(mockDeleteSessionKeysForInstance).toHaveBeenCalledWith(
          'test-id'
        );
      });
    });

    it('does not delete when confirmation cancelled', async () => {
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Session Keys'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      // Click cancel
      await user.click(screen.getByTestId('confirm-dialog-cancel'));

      expect(mockDeleteSessionKeysForInstance).not.toHaveBeenCalled();
    });

    it('navigates to keychain after deleting instance', async () => {
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Instance')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Instance'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      // Click the confirm button for delete instance dialog
      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(mockGetKeyManagerForInstance).toHaveBeenCalledWith('test-id');
        expect(mockKeyManagerReset).toHaveBeenCalled();
        expect(mockDeleteInstanceFromRegistry).toHaveBeenCalledWith('test-id');
        expect(mockNavigate).toHaveBeenCalledWith('/keychain');
      });
    });

    it('shows error when delete session keys fails', async () => {
      const consoleSpy = mockConsoleError();
      mockDeleteSessionKeysForInstance.mockRejectedValue(
        new Error('Delete session keys failed')
      );
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Session Keys'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      // Click confirm
      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(
          screen.getByText('Delete session keys failed')
        ).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete session keys:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('shows error when delete instance fails', async () => {
      const consoleSpy = mockConsoleError();
      mockDeleteInstanceFromRegistry.mockRejectedValue(
        new Error('Delete instance failed')
      );
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Instance')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Instance'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      // Click the confirm button for delete instance dialog
      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(screen.getByText('Delete instance failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete instance:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('shows error when delete session keys fails with non-Error', async () => {
      const consoleSpy = mockConsoleError();
      mockDeleteSessionKeysForInstance.mockRejectedValue('Session key error');
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Session Keys'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      // Click confirm
      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(screen.getByText('Session key error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete session keys:',
        'Session key error'
      );
      consoleSpy.mockRestore();
    });

    it('shows error when delete instance fails with non-Error', async () => {
      const consoleSpy = mockConsoleError();
      mockDeleteInstanceFromRegistry.mockRejectedValue('Instance error');
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Instance')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Instance'));

      await waitFor(() => {
        expect(screen.getByTestId('confirm-dialog')).toBeInTheDocument();
      });

      // Click the confirm button for delete instance dialog
      await user.click(screen.getByTestId('confirm-dialog-confirm'));

      await waitFor(() => {
        expect(screen.getByText('Instance error')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete instance:',
        'Instance error'
      );
      consoleSpy.mockRestore();
    });
  });

  describe('back link', () => {
    beforeEach(() => {
      mockGetInstances.mockResolvedValue([
        createInstance('test-id', 'Test Instance')
      ]);
      mockGetKeyStatusForInstance.mockResolvedValue(createKeyStatus());
    });

    it('displays back link', async () => {
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByTestId('back-link')).toBeInTheDocument();
      });
    });
  });
});
