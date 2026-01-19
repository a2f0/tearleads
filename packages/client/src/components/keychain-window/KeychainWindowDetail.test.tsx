import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyStatus } from '@/db/crypto/key-manager';
import type { InstanceMetadata } from '@/db/instance-registry';
import { mockConsoleError } from '@/test/console-mocks';
import { KeychainWindowDetail } from './KeychainWindowDetail';

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

const mockGetInstance =
  vi.fn<(instanceId: string) => Promise<InstanceMetadata | null>>();
const mockDeleteInstanceFromRegistry =
  vi.fn<(instanceId: string) => Promise<void>>();

vi.mock('@/db/instance-registry', () => ({
  getInstance: (instanceId: string) => mockGetInstance(instanceId),
  deleteInstanceFromRegistry: (instanceId: string) =>
    mockDeleteInstanceFromRegistry(instanceId)
}));

vi.mock('@/pages/keychain/DeleteSessionKeysDialog', () => ({
  DeleteSessionKeysDialog: ({
    open,
    onDelete
  }: {
    open: boolean;
    onDelete: () => Promise<void>;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => void onDelete().catch(() => {})}
        data-testid="confirm-delete-session"
      >
        Confirm Session Delete
      </button>
    ) : null
}));

vi.mock('@/pages/keychain/DeleteKeychainInstanceDialog', () => ({
  DeleteKeychainInstanceDialog: ({
    open,
    onDelete
  }: {
    open: boolean;
    onDelete: () => Promise<void>;
  }) =>
    open ? (
      <button
        type="button"
        onClick={() => void onDelete().catch(() => {})}
        data-testid="confirm-delete-instance"
      >
        Confirm Instance Delete
      </button>
    ) : null
}));

function renderDetail(
  instanceId: string,
  onBack = vi.fn(),
  onDeleted = vi.fn()
) {
  return render(
    <KeychainWindowDetail
      instanceId={instanceId}
      onBack={onBack}
      onDeleted={onDeleted}
    />
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

describe('KeychainWindowDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInstance.mockResolvedValue(null);
    mockGetKeyStatusForInstance.mockResolvedValue(createKeyStatus());
    mockDeleteSessionKeysForInstance.mockResolvedValue(undefined);
    mockKeyManagerReset.mockResolvedValue(undefined);
    mockDeleteInstanceFromRegistry.mockResolvedValue(undefined);
  });

  it('shows loading state initially', async () => {
    mockGetInstance.mockImplementation(() => new Promise(() => {}));

    renderDetail('instance-1');

    expect(screen.getByText('Loading instance...')).toBeInTheDocument();
  });

  it('shows error when instance is missing', async () => {
    mockGetInstance.mockResolvedValue(null);

    renderDetail('missing');

    await waitFor(() => {
      expect(screen.getByText('Instance not found')).toBeInTheDocument();
    });
  });

  it('renders instance details', async () => {
    const instance = createInstance('instance-1', 'My Instance');
    mockGetInstance.mockResolvedValue(instance);
    mockGetKeyStatusForInstance.mockResolvedValue(
      createKeyStatus(true, true, true, true)
    );

    renderDetail('instance-1');

    await waitFor(() => {
      expect(screen.getByText('My Instance')).toBeInTheDocument();
    });
    expect(screen.getByText('Instance Details')).toBeInTheDocument();
    expect(screen.getByText(instance.id)).toBeInTheDocument();
  });

  it('hides session key delete when no session keys exist', async () => {
    const instance = createInstance('instance-1', 'My Instance');
    mockGetInstance.mockResolvedValue(instance);
    mockGetKeyStatusForInstance.mockResolvedValue(
      createKeyStatus(false, false, false, false)
    );

    renderDetail('instance-1');

    await waitFor(() => {
      expect(screen.getByText('My Instance')).toBeInTheDocument();
    });

    expect(screen.queryByText('Delete Session Keys')).not.toBeInTheDocument();
  });

  it('calls onBack when back button is clicked', async () => {
    const instance = createInstance('instance-1', 'My Instance');
    mockGetInstance.mockResolvedValue(instance);

    const onBack = vi.fn();
    renderDetail('instance-1', onBack);

    const user = userEvent.setup();
    await user.click(screen.getByTestId('window-keychain-back'));

    expect(onBack).toHaveBeenCalled();
  });

  it('deletes session keys and refreshes details', async () => {
    const instance = createInstance('instance-1', 'My Instance');
    mockGetInstance.mockResolvedValue(instance);
    mockGetKeyStatusForInstance.mockResolvedValue(
      createKeyStatus(false, false, true, true)
    );

    renderDetail('instance-1');

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Session Keys'));
    await user.click(screen.getByTestId('confirm-delete-session'));

    await waitFor(() => {
      expect(mockDeleteSessionKeysForInstance).toHaveBeenCalledWith(
        'instance-1'
      );
    });
    expect(mockGetKeyStatusForInstance).toHaveBeenCalled();
  });

  it('shows error when delete session keys fails', async () => {
    const instance = createInstance('instance-1', 'My Instance');
    mockGetInstance.mockResolvedValue(instance);
    mockGetKeyStatusForInstance.mockResolvedValue(
      createKeyStatus(false, false, true, true)
    );
    mockDeleteSessionKeysForInstance.mockRejectedValue(
      new Error('Delete failed')
    );
    const consoleSpy = mockConsoleError();

    renderDetail('instance-1');

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByText('Delete Session Keys')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Session Keys'));
    await user.click(screen.getByTestId('confirm-delete-session'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete session keys:',
      expect.any(Error)
    );
  });

  it('deletes instance and calls onDeleted', async () => {
    const instance = createInstance('instance-1', 'My Instance');
    mockGetInstance.mockResolvedValue(instance);

    const onDeleted = vi.fn();
    renderDetail('instance-1', vi.fn(), onDeleted);

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByText('Delete Instance')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Instance'));
    await user.click(screen.getByTestId('confirm-delete-instance'));

    await waitFor(() => {
      expect(mockKeyManagerReset).toHaveBeenCalled();
      expect(mockDeleteInstanceFromRegistry).toHaveBeenCalledWith('instance-1');
    });
    expect(onDeleted).toHaveBeenCalled();
  });

  it('shows error when delete instance fails', async () => {
    const instance = createInstance('instance-1', 'My Instance');
    mockGetInstance.mockResolvedValue(instance);
    mockKeyManagerReset.mockRejectedValue(new Error('Delete failed'));
    const consoleSpy = mockConsoleError();

    renderDetail('instance-1');

    const user = userEvent.setup();
    await waitFor(() => {
      expect(screen.getByText('Delete Instance')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Delete Instance'));
    await waitFor(() => {
      expect(screen.getByTestId('confirm-delete-instance')).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('confirm-delete-instance'));

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete instance:',
      expect.any(Error)
    );
  });

  it('shows error when fetch fails', async () => {
    const consoleSpy = mockConsoleError();
    mockGetInstance.mockRejectedValue(new Error('Network error'));

    renderDetail('instance-1');

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch instance info:',
      expect.any(Error)
    );
  });
});
