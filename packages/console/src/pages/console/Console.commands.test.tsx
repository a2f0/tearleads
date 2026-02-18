import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  mockChangePassword,
  mockContext,
  mockSwitchInstance,
  renderConsole,
  renderConsoleWithAccountSwitcher,
  resetConsoleTestState
} from './Console.testHelpers';

describe('Console advanced commands', () => {
  beforeEach(() => {
    resetConsoleTestState();
  });

  it('changes password successfully', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockChangePassword.mockResolvedValue(true);
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'password{Enter}');

    // Current password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Current password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'oldpassword{Enter}');

    // New password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    // Confirm new password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm new password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Password changed successfully.')
      ).toBeInTheDocument();
    });
  });

  it('logs when password change fails with error', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockChangePassword.mockRejectedValue(new Error('Password exploded'));
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'password{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Current password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'oldpassword{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm new password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Password change failed: Password exploded')
      ).toBeInTheDocument();
    });
  });

  it('logs when current password is incorrect', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    mockChangePassword.mockResolvedValue(false);
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'password{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Current password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'oldpassword{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm new password:'
      );
    });
    await user.type(screen.getByTestId('terminal-input'), 'newpassword{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Incorrect current password.')
      ).toBeInTheDocument();
    });
  });

  it('clears console output with clear command', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'backup{Enter}');

    await waitFor(() => {
      expect(
        screen.getByText('Database locked. Unlock first.')
      ).toBeInTheDocument();
    });

    await user.type(input, 'clear{Enter}');

    await waitFor(() => {
      expect(
        screen.queryByText('Database locked. Unlock first.')
      ).not.toBeInTheDocument();
    });
  });

  it('shows status information', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'status{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Instance:.*Default/)).toBeInTheDocument();
      expect(screen.getByText(/Database:.*Locked/)).toBeInTheDocument();
    });
  });

  it('shows help for available commands', async () => {
    const user = userEvent.setup();
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'help{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Available commands:')).toBeInTheDocument();
    });
  });

  it('switches to another instance', async () => {
    const user = userEvent.setup();
    mockContext.currentInstanceId = 'instance-1';
    mockContext.currentInstanceName = 'Instance 1';
    mockContext.instances = [
      { id: 'instance-1', name: 'Instance 1' },
      { id: 'instance-2', name: 'Instance 2' }
    ];
    mockSwitchInstance.mockResolvedValue(true);
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'switch "Instance 2"{Enter}');

    await waitFor(() => {
      expect(mockSwitchInstance).toHaveBeenCalledWith('instance-2');
      expect(
        screen.getByText('Switched to instance: Instance 2')
      ).toBeInTheDocument();
    });
  });

  it('lists instances and marks the current one', async () => {
    const user = userEvent.setup();
    mockContext.currentInstanceId = 'instance-2';
    mockContext.currentInstanceName = 'Instance 2';
    mockContext.instances = [
      { id: 'instance-1', name: 'Instance 1' },
      { id: 'instance-2', name: 'Instance 2' }
    ];
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'list-instances{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Instances:')).toBeInTheDocument();
      expect(screen.getByText('Instance 1')).toBeInTheDocument();
      expect(screen.getByText('* Instance 2 (current)')).toBeInTheDocument();
    });
  });

  it('shows error for unknown commands', async () => {
    const user = userEvent.setup();
    renderConsole();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unknown{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Unknown command: unknown')).toBeInTheDocument();
    });
  });

  it('reflects terminal switch in the account switcher selection', async () => {
    const user = userEvent.setup();
    mockContext.isUnlocked = true;
    mockContext.currentInstanceId = 'instance-1';
    mockContext.currentInstanceName = 'Instance 1';
    mockContext.instances = [
      { id: 'instance-1', name: 'Instance 1' },
      { id: 'instance-2', name: 'Instance 2' }
    ];
    mockSwitchInstance.mockImplementation(async (instanceId: string) => {
      const target = mockContext.instances.find(
        (item) => item.id === instanceId
      );
      if (!target) {
        return false;
      }
      mockContext.currentInstanceId = target.id;
      mockContext.currentInstanceName = target.name;
      return true;
    });
    renderConsoleWithAccountSwitcher();

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'switch "Instance 2"{Enter}');

    await waitFor(() => {
      expect(mockSwitchInstance).toHaveBeenCalledWith('instance-2');
      expect(
        screen.getByText('Switched to instance: Instance 2')
      ).toBeInTheDocument();
    });

    await user.click(screen.getByTestId('account-switcher-button'));

    await waitFor(() => {
      expect(
        screen.getByTestId('instance-unlocked-instance-2')
      ).toBeInTheDocument();
    });
  });
});
