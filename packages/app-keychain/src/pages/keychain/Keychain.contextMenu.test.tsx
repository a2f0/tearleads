import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createInstance,
  createKeyStatus,
  mockGetInstances,
  mockGetKeyStatusForInstance,
  renderKeychain,
  resetKeychainPageTestState
} from './Keychain.testHelpers';

describe('Keychain context menu', () => {
  beforeEach(() => {
    resetKeychainPageTestState();
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
