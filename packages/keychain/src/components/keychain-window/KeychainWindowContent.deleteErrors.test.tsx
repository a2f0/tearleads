import {
  act,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { mockConsoleError } from '../../test/consoleMocks';
import './KeychainWindowContent.testHelpers';
import { KeychainWindowContent } from './KeychainWindowContent';
import {
  capturedOnDelete,
  mockDeleteSessionKeysForInstance,
  mockGetInstances,
  mockGetKeyStatusForInstance,
  resetKeychainWindowContentTestState
} from './KeychainWindowContent.testHelpers';

describe('KeychainWindowContent delete errors', () => {
  beforeEach(() => {
    resetKeychainWindowContentTestState();
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
  });

  it('shows error when delete fails', async () => {
    const consoleSpy = mockConsoleError();
    mockDeleteSessionKeysForInstance.mockRejectedValue(
      new Error('Delete failed')
    );

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
      try {
        await capturedOnDelete?.();
      } catch {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(screen.getByText('Delete failed')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete session keys:',
      expect.any(Error)
    );
  });

  it('shows error when delete fails with non-Error value', async () => {
    const consoleSpy = mockConsoleError();
    mockDeleteSessionKeysForInstance.mockRejectedValue('Delete string error');

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
      try {
        await capturedOnDelete?.();
      } catch {
        // Expected to throw
      }
    });

    await waitFor(() => {
      expect(screen.getByText('Delete string error')).toBeInTheDocument();
    });

    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to delete session keys:',
      'Delete string error'
    );
  });
});
