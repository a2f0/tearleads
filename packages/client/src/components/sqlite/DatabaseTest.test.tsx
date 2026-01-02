import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTest } from './DatabaseTest';

const mockUseDatabaseContext = vi.fn();

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db', () => ({
  getDatabaseAdapter: vi.fn()
}));

describe('DatabaseTest', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.restoreAllMocks();
  });

  function setupMockContext(overrides = {}) {
    const defaults = {
      isLoading: false,
      isSetUp: true,
      isUnlocked: false,
      setup: vi.fn(),
      unlock: vi.fn(),
      lock: vi.fn(),
      reset: vi.fn(),
      changePassword: vi.fn()
    };
    mockUseDatabaseContext.mockReturnValue({ ...defaults, ...overrides });
    return { ...defaults, ...overrides };
  }

  describe('unlock timing', () => {
    it('displays elapsed time when unlock succeeds', async () => {
      const user = userEvent.setup();

      // The unlock mock will simulate time passing by manipulating the mock
      let mockTime = 0;
      const mockNow = vi
        .spyOn(performance, 'now')
        .mockImplementation(() => mockTime);

      const unlock = vi.fn().mockImplementation(async () => {
        // Simulate 150ms passing during unlock
        mockTime = 150;
        return true;
      });
      setupMockContext({ unlock, isSetUp: true, isUnlocked: false });

      render(<DatabaseTest />);

      const unlockButton = screen.getByTestId('db-unlock-button');
      await user.click(unlockButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Database unlocked (150ms)');
        expect(result).toHaveAttribute('data-status', 'success');
      });

      mockNow.mockRestore();
    });

    it('displays elapsed time with different durations', async () => {
      const user = userEvent.setup();

      // The unlock mock will simulate time passing by manipulating the mock
      let mockTime = 0;
      const mockNow = vi
        .spyOn(performance, 'now')
        .mockImplementation(() => mockTime);

      const unlock = vi.fn().mockImplementation(async () => {
        // Simulate 1250ms passing during unlock
        mockTime = 1250;
        return true;
      });
      setupMockContext({ unlock, isSetUp: true, isUnlocked: false });

      render(<DatabaseTest />);

      const unlockButton = screen.getByTestId('db-unlock-button');
      await user.click(unlockButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Database unlocked (1250ms)');
      });

      mockNow.mockRestore();
    });

    it('does not display timing when unlock fails with wrong password', async () => {
      const user = userEvent.setup();
      const unlock = vi.fn().mockResolvedValue(false);
      setupMockContext({ unlock, isSetUp: true, isUnlocked: false });

      render(<DatabaseTest />);

      const unlockButton = screen.getByTestId('db-unlock-button');
      await user.click(unlockButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Wrong password');
        expect(result).not.toHaveTextContent('ms)');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });

    it('does not display timing when unlock throws an error', async () => {
      const user = userEvent.setup();
      const unlock = vi.fn().mockRejectedValue(new Error('Connection failed'));
      setupMockContext({ unlock, isSetUp: true, isUnlocked: false });

      render(<DatabaseTest />);

      const unlockButton = screen.getByTestId('db-unlock-button');
      await user.click(unlockButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Unlock error: Connection failed');
        expect(result).not.toHaveTextContent('ms)');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });
  });

  describe('lock', () => {
    it('displays success message when lock succeeds', async () => {
      const user = userEvent.setup();
      const lock = vi.fn().mockResolvedValue(undefined);
      setupMockContext({ lock, isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const lockButton = screen.getByTestId('db-lock-button');
      await user.click(lockButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Database locked');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });
  });

  describe('status display', () => {
    it('shows "Not Set Up" when database is not set up', () => {
      setupMockContext({ isSetUp: false, isUnlocked: false });
      render(<DatabaseTest />);
      expect(screen.getByTestId('db-status')).toHaveTextContent('Not Set Up');
    });

    it('shows "Locked" when database is set up but not unlocked', () => {
      setupMockContext({ isSetUp: true, isUnlocked: false });
      render(<DatabaseTest />);
      expect(screen.getByTestId('db-status')).toHaveTextContent('Locked');
    });

    it('shows "Unlocked" when database is unlocked', () => {
      setupMockContext({ isSetUp: true, isUnlocked: true });
      render(<DatabaseTest />);
      expect(screen.getByTestId('db-status')).toHaveTextContent('Unlocked');
    });

    it('shows "Loading..." when database is loading', () => {
      setupMockContext({ isLoading: true });
      render(<DatabaseTest />);
      expect(screen.getByTestId('db-status')).toHaveTextContent('Loading...');
    });
  });

  describe('setup', () => {
    it('calls setup with password when setup button is clicked', async () => {
      const user = userEvent.setup();
      const setup = vi.fn().mockResolvedValue(undefined);
      setupMockContext({ setup, isSetUp: false, isUnlocked: false });

      render(<DatabaseTest />);

      const passwordInput = screen.getByTestId('db-password-input');
      await user.clear(passwordInput);
      await user.type(passwordInput, 'mypassword');

      const setupButton = screen.getByTestId('db-setup-button');
      await user.click(setupButton);

      await waitFor(() => {
        expect(setup).toHaveBeenCalledWith('mypassword');
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Database setup complete');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });

    it('shows error message when setup fails', async () => {
      const user = userEvent.setup();
      const setup = vi.fn().mockRejectedValue(new Error('Setup failed'));
      setupMockContext({ setup, isSetUp: false, isUnlocked: false });

      render(<DatabaseTest />);

      const setupButton = screen.getByTestId('db-setup-button');
      await user.click(setupButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Setup error: Setup failed');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });
  });

  describe('reset', () => {
    it('calls reset when reset button is clicked', async () => {
      const user = userEvent.setup();
      const reset = vi.fn().mockResolvedValue(undefined);
      setupMockContext({ reset, isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const resetButton = screen.getByTestId('db-reset-button');
      await user.click(resetButton);

      await waitFor(() => {
        expect(reset).toHaveBeenCalled();
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Database reset complete');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });

    it('shows error message when reset fails', async () => {
      const user = userEvent.setup();
      const reset = vi.fn().mockRejectedValue(new Error('Reset failed'));
      setupMockContext({ reset, isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const resetButton = screen.getByTestId('db-reset-button');
      await user.click(resetButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Reset error: Reset failed');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });
  });

  describe('password visibility toggle', () => {
    it('toggles password visibility when eye button is clicked', async () => {
      const user = userEvent.setup();
      setupMockContext({ isSetUp: true, isUnlocked: false });

      render(<DatabaseTest />);

      const passwordInput = screen.getByTestId('db-password-input');
      expect(passwordInput).toHaveAttribute('type', 'password');

      const toggleButton = screen.getByLabelText('Show password');
      await user.click(toggleButton);

      expect(passwordInput).toHaveAttribute('type', 'text');

      const hideButton = screen.getByLabelText('Hide password');
      await user.click(hideButton);

      expect(passwordInput).toHaveAttribute('type', 'password');
    });
  });

  describe('lock error handling', () => {
    it('shows error message when lock fails', async () => {
      const user = userEvent.setup();
      const lock = vi.fn().mockRejectedValue(new Error('Lock failed'));
      setupMockContext({ lock, isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const lockButton = screen.getByTestId('db-lock-button');
      await user.click(lockButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Lock error: Lock failed');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });
  });

  describe('status color', () => {
    it.each([
      {
        status: 'success',
        mock: () => vi.fn().mockResolvedValue(undefined),
        expectedClass: 'text-green-600'
      },
      {
        status: 'error',
        mock: () => vi.fn().mockRejectedValue(new Error('Setup failed')),
        expectedClass: 'text-red-600'
      }
    ])('uses correct color class for $status status', async ({
      mock,
      expectedClass
    }) => {
      const user = userEvent.setup();
      setupMockContext({ setup: mock(), isSetUp: false, isUnlocked: false });

      render(<DatabaseTest />);

      const setupButton = screen.getByTestId('db-setup-button');
      await user.click(setupButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveClass(expectedClass);
      });
    });
  });
});
