import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyStatus } from '@/db/crypto/key-manager';
import type { InstanceMetadata } from '@/db/instance-registry';
import { mockConsoleError } from '@/test/console-mocks';
import { Keychain } from './Keychain';

// Mock key-manager functions
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

// Mock instance-registry functions
const mockGetInstances = vi.fn<() => Promise<InstanceMetadata[]>>();

vi.mock('@/db/instance-registry', () => ({
  getInstances: () => mockGetInstances()
}));

function renderKeychain() {
  return render(
    <MemoryRouter>
      <Keychain />
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

describe('Keychain', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: empty instances
    mockGetInstances.mockResolvedValue([]);
    mockGetKeyStatusForInstance.mockResolvedValue(createKeyStatus());
    mockDeleteSessionKeysForInstance.mockResolvedValue(undefined);

    // Mock window.confirm
    vi.spyOn(window, 'confirm').mockImplementation(() => true);
  });

  describe('page rendering', () => {
    it('renders the page title', async () => {
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Keychain Browser')).toBeInTheDocument();
      });
    });

    it('renders Refresh button', async () => {
      renderKeychain();

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Refresh' })
        ).toBeInTheDocument();
      });
    });
  });

  describe('empty state', () => {
    it('shows empty state message when no instances exist', async () => {
      mockGetInstances.mockResolvedValue([]);

      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('No instances found.')).toBeInTheDocument();
      });
    });
  });

  describe('with instance data', () => {
    const testInstances: InstanceMetadata[] = [
      createInstance(
        'instance-1',
        'Test Instance 1',
        1704067200000,
        1704153600000
      ),
      createInstance(
        'instance-2',
        'Test Instance 2',
        1704240000000,
        1704326400000
      )
    ];

    beforeEach(() => {
      mockGetInstances.mockResolvedValue(testInstances);
      mockGetKeyStatusForInstance.mockImplementation(
        async (instanceId: string) => {
          if (instanceId === 'instance-1') {
            return createKeyStatus(true, true, true, true);
          }
          return createKeyStatus(true, true, false, false);
        }
      );
    });

    it('displays instance names', async () => {
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Test Instance 1')).toBeInTheDocument();
        expect(screen.getByText('Test Instance 2')).toBeInTheDocument();
      });
    });

    it('displays instance count in header', async () => {
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('2 instances')).toBeInTheDocument();
      });
    });

    it('displays full instance IDs in expanded section', async () => {
      renderKeychain();

      await waitFor(() => {
        // Full ID is shown underneath the label when expanded
        expect(screen.getByText('instance-1')).toBeInTheDocument();
        expect(screen.getByText('instance-2')).toBeInTheDocument();
      });
    });

    it('displays timestamps when expanded', async () => {
      renderKeychain();

      await waitFor(() => {
        // Check for Created: text
        expect(screen.getAllByText(/Created:/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Last accessed:/).length).toBeGreaterThan(0);
      });
    });

    it('shows key status indicators', async () => {
      renderKeychain();

      await waitFor(() => {
        // Should show Salt, Key Check Value, Session Wrapping Key, Session Wrapped Key labels
        expect(screen.getAllByText('Salt').length).toBeGreaterThan(0);
        expect(screen.getAllByText('Key Check Value').length).toBeGreaterThan(
          0
        );
        expect(
          screen.getAllByText('Session Wrapping Key').length
        ).toBeGreaterThan(0);
        expect(
          screen.getAllByText('Session Wrapped Key').length
        ).toBeGreaterThan(0);
      });
    });
  });

  describe('delete session keys functionality', () => {
    const instanceWithSession = createInstance(
      'instance-with-session',
      'Has Session'
    );

    beforeEach(() => {
      mockGetInstances.mockResolvedValue([instanceWithSession]);
      mockGetKeyStatusForInstance.mockResolvedValue(
        createKeyStatus(true, true, true, true)
      );
    });

    it('shows confirmation dialog when deleting session keys', async () => {
      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Has Session')).toBeInTheDocument();
      });

      // Find and click delete button
      const deleteButton = screen.getByTitle('Delete session keys');
      await user.click(deleteButton);

      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining('Are you sure you want to delete session keys')
      );
    });

    it('does not delete when confirmation is cancelled', async () => {
      vi.spyOn(window, 'confirm').mockImplementation(() => false);

      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Has Session')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete session keys');
      await user.click(deleteButton);

      expect(mockDeleteSessionKeysForInstance).not.toHaveBeenCalled();
    });

    it('deletes session keys when confirmed', async () => {
      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Has Session')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete session keys');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(mockDeleteSessionKeysForInstance).toHaveBeenCalledWith(
          'instance-with-session'
        );
      });
    });

    it('refreshes display after deletion', async () => {
      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Has Session')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete session keys');
      await user.click(deleteButton);

      await waitFor(() => {
        // getInstances should be called again after deletion
        expect(mockGetInstances).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('delete button visibility', () => {
    it('shows delete button only when session keys exist', async () => {
      const instanceWithSession = createInstance(
        'with-session',
        'With Session'
      );
      const instanceWithoutSession = createInstance('no-session', 'No Session');

      mockGetInstances.mockResolvedValue([
        instanceWithSession,
        instanceWithoutSession
      ]);
      mockGetKeyStatusForInstance.mockImplementation(
        async (instanceId: string) => {
          if (instanceId === 'with-session') {
            return createKeyStatus(true, true, true, true);
          }
          return createKeyStatus(true, true, false, false);
        }
      );

      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('With Session')).toBeInTheDocument();
        expect(screen.getByText('No Session')).toBeInTheDocument();
      });

      // Only one delete button should exist (for instance with session)
      const deleteButtons = screen.getAllByTitle('Delete session keys');
      expect(deleteButtons).toHaveLength(1);
    });
  });

  describe('refresh functionality', () => {
    it('refreshes content when refresh button is clicked', async () => {
      mockGetInstances.mockResolvedValue([]);

      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('No instances found.')).toBeInTheDocument();
      });

      expect(mockGetInstances).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: 'Refresh' }));

      await waitFor(() => {
        expect(mockGetInstances).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when getInstances fails', async () => {
      const consoleSpy = mockConsoleError();
      mockGetInstances.mockRejectedValue(new Error('Failed to load instances'));

      renderKeychain();

      await waitFor(() => {
        expect(
          screen.getByText('Failed to load instances')
        ).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to fetch keychain data:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });

    it('displays error message when delete fails', async () => {
      const consoleSpy = mockConsoleError();
      const instance = createInstance('test-instance', 'Test');
      mockGetInstances.mockResolvedValue([instance]);
      mockGetKeyStatusForInstance.mockResolvedValue(
        createKeyStatus(true, true, true, true)
      );
      mockDeleteSessionKeysForInstance.mockRejectedValue(
        new Error('Delete failed')
      );

      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Test')).toBeInTheDocument();
      });

      const deleteButton = screen.getByTitle('Delete session keys');
      await user.click(deleteButton);

      await waitFor(() => {
        expect(screen.getByText('Delete failed')).toBeInTheDocument();
      });
      expect(consoleSpy).toHaveBeenCalledWith(
        'Failed to delete session keys:',
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('singular/plural instance count', () => {
    it('shows singular "instance" for 1 instance', async () => {
      mockGetInstances.mockResolvedValue([createInstance('only', 'Only One')]);
      mockGetKeyStatusForInstance.mockResolvedValue(createKeyStatus());

      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('1 instance')).toBeInTheDocument();
      });
    });

    it('shows plural "instances" for multiple instances', async () => {
      mockGetInstances.mockResolvedValue([
        createInstance('first', 'First'),
        createInstance('second', 'Second')
      ]);
      mockGetKeyStatusForInstance.mockResolvedValue(createKeyStatus());

      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('2 instances')).toBeInTheDocument();
      });
    });
  });

  describe('expand/collapse functionality', () => {
    beforeEach(() => {
      mockGetInstances.mockResolvedValue([
        createInstance('test', 'Test Instance')
      ]);
      mockGetKeyStatusForInstance.mockResolvedValue(
        createKeyStatus(true, true, false, false)
      );
    });

    it('instances are expanded by default', async () => {
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Test Instance')).toBeInTheDocument();
        // Key status labels should be visible when expanded
        expect(screen.getByText('Salt')).toBeInTheDocument();
      });
    });

    it('collapses instance when clicked', async () => {
      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Salt')).toBeInTheDocument();
      });

      // Click the instance row to collapse
      const instanceButton = screen.getByRole('button', {
        name: /Test Instance/i
      });
      await user.click(instanceButton);

      await waitFor(() => {
        expect(screen.queryByText('Salt')).not.toBeInTheDocument();
      });
    });

    it('expands instance when clicked again', async () => {
      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Salt')).toBeInTheDocument();
      });

      const instanceButton = screen.getByRole('button', {
        name: /Test Instance/i
      });

      // Collapse
      await user.click(instanceButton);
      await waitFor(() => {
        expect(screen.queryByText('Salt')).not.toBeInTheDocument();
      });

      // Expand again
      await user.click(instanceButton);
      await waitFor(() => {
        expect(screen.getByText('Salt')).toBeInTheDocument();
      });
    });
  });

  describe('loading state', () => {
    it('shows loading state initially', async () => {
      // Make getInstances hang
      mockGetInstances.mockImplementation(
        () => new Promise(() => {}) // Never resolves
      );

      renderKeychain();

      expect(
        screen.getByText('Loading keychain contents...')
      ).toBeInTheDocument();
    });
  });

  describe('context menu', () => {
    beforeEach(() => {
      mockGetInstances.mockResolvedValue([
        createInstance('test-id', 'Test Instance')
      ]);
      mockGetKeyStatusForInstance.mockResolvedValue(
        createKeyStatus(true, true, false, false)
      );
    });

    it('shows context menu on right-click', async () => {
      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Test Instance')).toBeInTheDocument();
      });

      const row = screen
        .getByText('Test Instance')
        .closest('div[class*="border-b"]');
      expect(row).toBeInTheDocument();

      if (row) {
        await user.pointer({ target: row, keys: '[MouseRight]' });
      }

      await waitFor(() => {
        expect(screen.getByText('View Details')).toBeInTheDocument();
      });
    });

    it('closes context menu on escape', async () => {
      const user = userEvent.setup();
      renderKeychain();

      await waitFor(() => {
        expect(screen.getByText('Test Instance')).toBeInTheDocument();
      });

      const row = screen
        .getByText('Test Instance')
        .closest('div[class*="border-b"]');
      if (row) {
        await user.pointer({ target: row, keys: '[MouseRight]' });
      }

      await waitFor(() => {
        expect(screen.getByText('View Details')).toBeInTheDocument();
      });

      await user.keyboard('{Escape}');

      await waitFor(() => {
        expect(screen.queryByText('View Details')).not.toBeInTheDocument();
      });
    });
  });
});
