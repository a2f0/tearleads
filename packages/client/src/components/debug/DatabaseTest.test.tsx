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
});
