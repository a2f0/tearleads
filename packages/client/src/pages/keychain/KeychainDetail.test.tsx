import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyStatus } from '@/db/crypto/key-manager';
import type { InstanceMetadata } from '@/db/instance-registry';
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

vi.mock('@/db/crypto/key-manager', () => ({
  getKeyStatusForInstance: (instanceId: string) =>
    mockGetKeyStatusForInstance(instanceId),
  deleteSessionKeysForInstance: (instanceId: string) =>
    mockDeleteSessionKeysForInstance(instanceId)
}));

const mockGetInstances = vi.fn<() => Promise<InstanceMetadata[]>>();

vi.mock('@/db/instance-registry', () => ({
  getInstances: () => mockGetInstances()
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
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
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
      mockGetInstances.mockRejectedValue(new Error('Network error'));

      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
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

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Are you sure you want to delete session keys')
      );
    });

    it('deletes session keys when confirmed', async () => {
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Session Keys'));

      await waitFor(() => {
        expect(mockDeleteSessionKeysForInstance).toHaveBeenCalledWith(
          'test-id'
        );
      });
    });

    it('does not delete when confirmation cancelled', async () => {
      vi.spyOn(window, 'confirm').mockImplementation(() => false);
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Session Keys'));

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
        expect(mockNavigate).toHaveBeenCalledWith('/keychain');
      });
    });

    it('shows error when delete session keys fails', async () => {
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
        expect(
          screen.getByText('Delete session keys failed')
        ).toBeInTheDocument();
      });
    });

    it('shows error when delete instance fails', async () => {
      mockDeleteSessionKeysForInstance.mockRejectedValue(
        new Error('Delete instance failed')
      );
      const user = userEvent.setup();
      renderKeychainDetail('test-id');

      await waitFor(() => {
        expect(screen.getByText('Delete Instance')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Delete Instance'));

      await waitFor(() => {
        expect(screen.getByText('Delete instance failed')).toBeInTheDocument();
      });
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
