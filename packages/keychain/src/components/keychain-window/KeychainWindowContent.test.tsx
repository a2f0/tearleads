import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { createRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockConsoleError } from '../../test/consoleMocks';
import {
  capturedMenuOnClose,
  capturedOnDelete,
  mockDeleteSessionKeysForInstance,
  mockGetInstances,
  mockGetKeyStatusForInstance,
  resetKeychainWindowContentTestState
} from './KeychainWindowContent.testHelpers';
import type { KeychainWindowContentRef } from './KeychainWindowContent';
import { KeychainWindowContent } from './KeychainWindowContent';

describe('KeychainWindowContent', () => {
  beforeEach(() => {
    resetKeychainWindowContentTestState();
  });

  it('shows loading state initially', async () => {
    mockGetInstances.mockReturnValue(new Promise(() => {}));
    render(<KeychainWindowContent />);

    expect(
      screen.getByText('Loading keychain contents...')
    ).toBeInTheDocument();
  });

  it('shows empty state when no instances', async () => {
    mockGetInstances.mockResolvedValue([]);
    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByText('No instances found.')).toBeInTheDocument();
    });
  });

  it('shows instance count', async () => {
    mockGetInstances.mockResolvedValue([
      { id: 'instance-1', name: 'Instance 1', createdAt: 0, lastAccessedAt: 0 }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByText('1 instance')).toBeInTheDocument();
    });
  });

  it('shows plural instance count', async () => {
    mockGetInstances.mockResolvedValue([
      { id: 'instance-1', name: 'Instance 1', createdAt: 0, lastAccessedAt: 0 },
      { id: 'instance-2', name: 'Instance 2', createdAt: 0, lastAccessedAt: 0 }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByText('2 instances')).toBeInTheDocument();
    });
  });

  it('renders instance rows', async () => {
    mockGetInstances.mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test Instance',
        createdAt: 0,
        lastAccessedAt: 0
      }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByTestId('instance-row-instance-1')).toBeInTheDocument();
      expect(screen.getByText('Test Instance')).toBeInTheDocument();
    });
  });

  it('shows error state when fetch fails with Error', async () => {
    mockGetInstances.mockRejectedValue(new Error('Failed to load'));
    const consoleSpy = mockConsoleError();
    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch keychain data:',
      expect.any(Error)
    );
  });

  it('shows error state when fetch fails with non-Error value', async () => {
    mockGetInstances.mockRejectedValue('String error message');
    const consoleSpy = mockConsoleError();
    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByText('String error message')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to fetch keychain data:',
      'String error message'
    );
  });

  it('wraps content in scrollable container', async () => {
    mockGetInstances.mockResolvedValue([]);
    render(<KeychainWindowContent />);

    await waitFor(() => {
      const container = screen.getByText('0 instances').closest('.h-full');
      expect(container).toHaveClass('overflow-auto');
    });
  });

  it('exposes refresh via ref', async () => {
    mockGetInstances.mockResolvedValue([]);
    const ref = createRef<KeychainWindowContentRef>();
    render(<KeychainWindowContent ref={ref} />);

    await waitFor(() => {
      expect(ref.current).not.toBeNull();
      expect(ref.current?.refresh).toBeDefined();
      expect(typeof ref.current?.refresh).toBe('function');
    });
  });

  it('refresh can be called without error', async () => {
    mockGetInstances.mockResolvedValue([]);
    const ref = createRef<KeychainWindowContentRef>();
    render(<KeychainWindowContent ref={ref} />);

    await waitFor(() => {
      expect(ref.current?.refresh).toBeDefined();
    });

    await act(async () => {
      expect(() => ref.current?.refresh()).not.toThrow();
    });
  });

  it('handles toggle callback', async () => {
    mockGetInstances.mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test Instance',
        createdAt: 0,
        lastAccessedAt: 0
      }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-btn')).toBeInTheDocument();
    });

    // First toggle collapses (since instances start expanded)
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-btn'));
    });

    // Second toggle expands again
    await act(async () => {
      fireEvent.click(screen.getByTestId('toggle-btn'));
    });

    // Both code paths (add and delete) were exercised
  });

  it('opens context menu when context callback is triggered', async () => {
    mockGetInstances.mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test Instance',
        createdAt: 0,
        lastAccessedAt: 0
      }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByTestId('context-btn')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('context-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });
  });

  it('opens detail view in the floating window when view details is clicked', async () => {
    mockGetInstances.mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test Instance',
        createdAt: 0,
        lastAccessedAt: 0
      }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    const onSelectInstance = vi.fn();
    render(<KeychainWindowContent onSelectInstance={onSelectInstance} />);

    await waitFor(() => {
      expect(screen.getByTestId('context-btn')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('context-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('context-menu-item')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('context-menu-item'));
    });

    expect(onSelectInstance).toHaveBeenCalledWith('instance-1');
  });

  it('closes context menu when onClose is called', async () => {
    mockGetInstances.mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test Instance',
        createdAt: 0,
        lastAccessedAt: 0
      }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByTestId('context-btn')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('context-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('context-menu')).toBeInTheDocument();
    });

    await act(async () => {
      capturedMenuOnClose?.();
    });

    await waitFor(() => {
      expect(screen.queryByTestId('context-menu')).not.toBeInTheDocument();
    });
  });

  it('opens delete dialog when delete session keys is clicked', async () => {
    mockGetInstances.mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test Instance',
        createdAt: 0,
        lastAccessedAt: 0
      }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-btn')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
    });
  });

  it('closes delete dialog when cancel is clicked', async () => {
    mockGetInstances.mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test Instance',
        createdAt: 0,
        lastAccessedAt: 0
      }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-btn')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('cancel-delete'));
    });

    await waitFor(() => {
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    });
  });

  it('calls deleteSessionKeysForInstance when confirm delete is clicked', async () => {
    mockGetInstances.mockResolvedValue([
      {
        id: 'instance-1',
        name: 'Test Instance',
        createdAt: 0,
        lastAccessedAt: 0
      }
    ]);
    mockGetKeyStatusForInstance.mockResolvedValue({
      salt: true,
      keyCheckValue: true,
      wrappingKey: false,
      wrappedKey: false
    });
    mockDeleteSessionKeysForInstance.mockResolvedValue(undefined);

    render(<KeychainWindowContent />);

    await waitFor(() => {
      expect(screen.getByTestId('delete-btn')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId('delete-btn'));
    });

    await waitFor(() => {
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
    });

    await act(async () => {
      await capturedOnDelete?.();
    });

    expect(mockDeleteSessionKeysForInstance).toHaveBeenCalledWith('instance-1');
  });

});
