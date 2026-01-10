import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTest } from './DatabaseTest';

const mockUseDatabaseContext = vi.fn();
const mockGetDatabaseAdapter = vi.fn();
let capturedInstanceChangeCallback: (() => void) | null = null;

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db', () => ({
  getDatabaseAdapter: () => mockGetDatabaseAdapter()
}));

vi.mock('@/hooks/useInstanceChange', () => ({
  useOnInstanceChange: (callback: () => void) => {
    capturedInstanceChangeCallback = callback;
  }
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: string[]) => args.filter(Boolean).join(' '),
  detectPlatform: () => 'web'
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
      hasPersistedSession: false,
      setup: vi.fn(),
      unlock: vi.fn(),
      lock: vi.fn(),
      reset: vi.fn(),
      changePassword: vi.fn(),
      restoreSession: vi.fn()
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

    it('shows yellow color for running status', async () => {
      const user = userEvent.setup();
      // Create a deferred promise pattern
      let resolveSetup: (() => void) | undefined;
      const setupPromise = new Promise<void>((resolve) => {
        resolveSetup = resolve;
      });
      const setup = vi.fn().mockImplementation(() => setupPromise);
      setupMockContext({ setup, isSetUp: false, isUnlocked: false });

      render(<DatabaseTest />);

      const setupButton = screen.getByTestId('db-setup-button');
      await user.click(setupButton);

      // While setup is running, check for yellow color
      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveClass('text-yellow-600');
        expect(result).toHaveAttribute('data-status', 'running');
      });

      // Resolve the promise and wait for the state update
      if (resolveSetup) {
        resolveSetup();
      }
      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });
  });

  describe('write data', () => {
    it('writes test data when database is unlocked', async () => {
      const user = userEvent.setup();
      const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
      mockGetDatabaseAdapter.mockReturnValue({ execute: mockExecute });
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const writeButton = screen.getByTestId('db-write-button');
      await user.click(writeButton);

      // Wait for the success result to appear
      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveAttribute('data-status', 'success');
      });

      expect(mockExecute).toHaveBeenCalledWith(
        expect.stringContaining('INSERT OR REPLACE INTO user_settings'),
        expect.arrayContaining([
          'test_key',
          expect.any(String),
          expect.any(Number)
        ])
      );
      const result = screen.getByTestId('db-test-result');
      expect(result).toHaveTextContent('Wrote test data:');
    });

    it('shows error when trying to write without unlock', () => {
      setupMockContext({ isSetUp: true, isUnlocked: false });

      render(<DatabaseTest />);

      // The button won't be visible when locked, which is correct behavior
      expect(screen.queryByTestId('db-write-button')).not.toBeInTheDocument();
    });

    it('shows error when write fails', async () => {
      const user = userEvent.setup();
      const mockExecute = vi
        .fn()
        .mockRejectedValue(new Error('Database error'));
      mockGetDatabaseAdapter.mockReturnValue({ execute: mockExecute });
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const writeButton = screen.getByTestId('db-write-button');
      await user.click(writeButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Write error: Database error');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });
  });

  describe('read data', () => {
    it('reads test data when database is unlocked', async () => {
      const user = userEvent.setup();
      const mockExecute = vi.fn().mockResolvedValue({
        rows: [{ value: 'test-value-123' }]
      });
      mockGetDatabaseAdapter.mockReturnValue({ execute: mockExecute });
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const readButton = screen.getByTestId('db-read-button');
      await user.click(readButton);

      await waitFor(() => {
        expect(mockExecute).toHaveBeenCalledWith(
          expect.stringContaining('SELECT value FROM user_settings'),
          ['test_key']
        );
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Read test data: test-value-123');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });

    it('shows message when no test data found', async () => {
      const user = userEvent.setup();
      const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
      mockGetDatabaseAdapter.mockReturnValue({ execute: mockExecute });
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const readButton = screen.getByTestId('db-read-button');
      await user.click(readButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('No test data found');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });

    it('shows error when read fails', async () => {
      const user = userEvent.setup();
      const mockExecute = vi.fn().mockRejectedValue(new Error('Read failed'));
      mockGetDatabaseAdapter.mockReturnValue({ execute: mockExecute });
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const readButton = screen.getByTestId('db-read-button');
      await user.click(readButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Read error: Read failed');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });
  });

  describe('change password', () => {
    it('shows change password form when toggle is clicked', async () => {
      const user = userEvent.setup();
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const toggleButton = screen.getByTestId('db-change-password-toggle');
      await user.click(toggleButton);

      expect(screen.getByTestId('db-new-password-input')).toBeInTheDocument();
      expect(
        screen.getByTestId('db-change-password-button')
      ).toBeInTheDocument();
    });

    it('hides change password form when toggle is clicked again', async () => {
      const user = userEvent.setup();
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const toggleButton = screen.getByTestId('db-change-password-toggle');
      await user.click(toggleButton);
      await user.click(toggleButton);

      expect(
        screen.queryByTestId('db-new-password-input')
      ).not.toBeInTheDocument();
    });

    it('changes password successfully', async () => {
      const user = userEvent.setup();
      const changePassword = vi.fn().mockResolvedValue(true);
      setupMockContext({ isSetUp: true, isUnlocked: true, changePassword });

      render(<DatabaseTest />);

      const toggleButton = screen.getByTestId('db-change-password-toggle');
      await user.click(toggleButton);

      const newPasswordInput = screen.getByTestId('db-new-password-input');
      await user.type(newPasswordInput, 'newpassword123');

      const confirmButton = screen.getByTestId('db-change-password-button');
      await user.click(confirmButton);

      await waitFor(() => {
        expect(changePassword).toHaveBeenCalledWith(
          'testpassword123',
          'newpassword123'
        );
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Password changed successfully');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });

    it('shows error when change password fails with wrong current password', async () => {
      const user = userEvent.setup();
      const changePassword = vi.fn().mockResolvedValue(false);
      setupMockContext({ isSetUp: true, isUnlocked: true, changePassword });

      render(<DatabaseTest />);

      const toggleButton = screen.getByTestId('db-change-password-toggle');
      await user.click(toggleButton);

      const newPasswordInput = screen.getByTestId('db-new-password-input');
      await user.type(newPasswordInput, 'newpassword123');

      const confirmButton = screen.getByTestId('db-change-password-button');
      await user.click(confirmButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Wrong current password');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });

    it('shows error when change password throws', async () => {
      const user = userEvent.setup();
      const changePassword = vi
        .fn()
        .mockRejectedValue(new Error('Change failed'));
      setupMockContext({ isSetUp: true, isUnlocked: true, changePassword });

      render(<DatabaseTest />);

      const toggleButton = screen.getByTestId('db-change-password-toggle');
      await user.click(toggleButton);

      const newPasswordInput = screen.getByTestId('db-new-password-input');
      await user.type(newPasswordInput, 'newpassword123');

      const confirmButton = screen.getByTestId('db-change-password-button');
      await user.click(confirmButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent(
          'Change password error: Change failed'
        );
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });

    it('shows error when new password is empty', async () => {
      const user = userEvent.setup();
      const changePassword = vi.fn();
      setupMockContext({ isSetUp: true, isUnlocked: true, changePassword });

      render(<DatabaseTest />);

      const toggleButton = screen.getByTestId('db-change-password-toggle');
      await user.click(toggleButton);

      // The confirm button should be disabled when new password is empty
      const confirmButton = screen.getByTestId('db-change-password-button');
      expect(confirmButton).toBeDisabled();
    });
  });

  describe('restore session', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('shows restore session button when persisted session exists', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: false,
        hasPersistedSession: true
      });

      render(<DatabaseTest />);

      expect(
        screen.getByTestId('db-restore-session-button')
      ).toBeInTheDocument();
    });

    it('restores session successfully', async () => {
      const user = userEvent.setup();
      let mockTime = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => mockTime);

      const restoreSession = vi.fn().mockImplementation(async () => {
        mockTime = 200;
        return true;
      });
      setupMockContext({
        isSetUp: true,
        isUnlocked: false,
        hasPersistedSession: true,
        restoreSession
      });

      render(<DatabaseTest />);

      const restoreButton = screen.getByTestId('db-restore-session-button');
      await user.click(restoreButton);

      await waitFor(() => {
        expect(restoreSession).toHaveBeenCalled();
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Session restored (200ms)');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });

    it('shows error when no persisted session found', async () => {
      const user = userEvent.setup();
      const restoreSession = vi.fn().mockResolvedValue(false);
      setupMockContext({
        isSetUp: true,
        isUnlocked: false,
        hasPersistedSession: true,
        restoreSession
      });

      render(<DatabaseTest />);

      const restoreButton = screen.getByTestId('db-restore-session-button');
      await user.click(restoreButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('No persisted session found');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });

    it('shows error when restore session throws', async () => {
      const user = userEvent.setup();
      const restoreSession = vi
        .fn()
        .mockRejectedValue(new Error('Restore failed'));
      setupMockContext({
        isSetUp: true,
        isUnlocked: false,
        hasPersistedSession: true,
        restoreSession
      });

      render(<DatabaseTest />);

      const restoreButton = screen.getByTestId('db-restore-session-button');
      await user.click(restoreButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Restore error: Restore failed');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });
  });

  describe('lock with clear session', () => {
    it('shows lock & clear session button when persisted session exists', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        hasPersistedSession: true
      });

      render(<DatabaseTest />);

      expect(
        screen.getByTestId('db-lock-clear-session-button')
      ).toBeInTheDocument();
    });

    it('locks and clears session when button is clicked', async () => {
      const user = userEvent.setup();
      const lock = vi.fn().mockResolvedValue(undefined);
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        hasPersistedSession: true,
        lock
      });

      render(<DatabaseTest />);

      const lockClearButton = screen.getByTestId(
        'db-lock-clear-session-button'
      );
      await user.click(lockClearButton);

      await waitFor(() => {
        expect(lock).toHaveBeenCalledWith(true);
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Database locked (session cleared)');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });
  });

  describe('persist unlock checkbox', () => {
    it('shows persist checkbox when database is locked', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: false
      });

      render(<DatabaseTest />);

      expect(screen.getByTestId('db-persist-checkbox')).toBeInTheDocument();
    });

    it('unlocks with persist flag when checkbox is checked', async () => {
      const user = userEvent.setup();
      const unlock = vi.fn().mockResolvedValue(true);
      setupMockContext({
        isSetUp: true,
        isUnlocked: false,
        unlock
      });

      render(<DatabaseTest />);

      const persistCheckbox = screen.getByTestId('db-persist-checkbox');
      await user.click(persistCheckbox);

      const unlockButton = screen.getByTestId('db-unlock-button');
      await user.click(unlockButton);

      await waitFor(() => {
        expect(unlock).toHaveBeenCalledWith('testpassword123', true);
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent(
          'Database unlocked (session persisted)'
        );
      });
    });
  });

  describe('session status display', () => {
    it('shows session persisted status when hasPersistedSession is true', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: false,
        hasPersistedSession: true
      });

      render(<DatabaseTest />);

      expect(screen.getByTestId('db-session-status')).toHaveTextContent('Yes');
    });

    it('shows session not persisted when hasPersistedSession is false', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: false,
        hasPersistedSession: false
      });

      render(<DatabaseTest />);

      expect(screen.getByTestId('db-session-status')).toHaveTextContent('No');
    });
  });

  describe('test data display', () => {
    it('displays test data after write', async () => {
      const user = userEvent.setup();
      const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
      mockGetDatabaseAdapter.mockReturnValue({ execute: mockExecute });
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const writeButton = screen.getByTestId('db-write-button');
      await user.click(writeButton);

      await waitFor(() => {
        expect(screen.getByTestId('db-test-data')).toBeInTheDocument();
      });
    });
  });

  describe('copy error to clipboard', () => {
    const originalClipboard = navigator.clipboard;

    afterEach(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: originalClipboard,
        writable: true,
        configurable: true
      });
    });

    function setupClipboardMock(
      mockFn: ReturnType<typeof vi.fn>
    ): ReturnType<typeof vi.fn> {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: mockFn },
        writable: true,
        configurable: true
      });
      return mockFn;
    }

    it('copies error message to clipboard when copy button is clicked', async () => {
      const user = userEvent.setup();
      const writeText = setupClipboardMock(
        vi.fn().mockResolvedValue(undefined)
      );

      const setup = vi.fn().mockRejectedValue(new Error('Test error'));
      setupMockContext({ setup, isSetUp: false, isUnlocked: false });

      render(<DatabaseTest />);

      const setupButton = screen.getByTestId('db-setup-button');
      await user.click(setupButton);

      await waitFor(() => {
        expect(screen.getByTestId('db-test-result')).toHaveAttribute(
          'data-status',
          'error'
        );
      });

      const copyButton = screen.getByLabelText('Copy error to clipboard');
      await user.click(copyButton);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith('Setup error: Test error');
      });
    });

    it('handles clipboard write failure gracefully', async () => {
      const user = userEvent.setup();
      const writeText = setupClipboardMock(
        vi.fn().mockRejectedValue(new Error('Clipboard error'))
      );

      const setup = vi.fn().mockRejectedValue(new Error('Test error'));
      setupMockContext({ setup, isSetUp: false, isUnlocked: false });

      render(<DatabaseTest />);

      const setupButton = screen.getByTestId('db-setup-button');
      await user.click(setupButton);

      await waitFor(() => {
        expect(screen.getByTestId('db-test-result')).toHaveAttribute(
          'data-status',
          'error'
        );
      });

      const copyButton = screen.getByLabelText('Copy error to clipboard');
      await user.click(copyButton);

      // Should not throw, just return false
      await waitFor(() => {
        expect(writeText).toHaveBeenCalled();
      });
    });
  });

  describe('form submission', () => {
    it('calls setup on form submit when not set up', async () => {
      const user = userEvent.setup();
      const setup = vi.fn().mockResolvedValue(undefined);
      setupMockContext({ setup, isSetUp: false, isUnlocked: false });

      render(<DatabaseTest />);

      const passwordInput = screen.getByTestId('db-password-input');
      await user.type(passwordInput, '{enter}');

      await waitFor(() => {
        expect(setup).toHaveBeenCalled();
      });
    });

    it('calls unlock on form submit when set up but locked', async () => {
      const user = userEvent.setup();
      const unlock = vi.fn().mockResolvedValue(true);
      setupMockContext({ unlock, isSetUp: true, isUnlocked: false });

      render(<DatabaseTest />);

      const passwordInput = screen.getByTestId('db-password-input');
      await user.type(passwordInput, '{enter}');

      await waitFor(() => {
        expect(unlock).toHaveBeenCalled();
      });
    });
  });

  describe('read data with invalid row format', () => {
    it('handles row without value property', async () => {
      const user = userEvent.setup();
      const mockExecute = vi.fn().mockResolvedValue({
        rows: [{ other: 'data' }]
      });
      mockGetDatabaseAdapter.mockReturnValue({ execute: mockExecute });
      setupMockContext({ isSetUp: true, isUnlocked: true });

      render(<DatabaseTest />);

      const readButton = screen.getByTestId('db-read-button');
      await user.click(readButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Read test data:');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });
  });

  describe('instance switching', () => {
    beforeEach(() => {
      capturedInstanceChangeCallback = null;
    });

    it('resets testResult when instance change event is emitted', async () => {
      const user = userEvent.setup();
      const setup = vi.fn().mockResolvedValue(undefined);
      setupMockContext({
        setup,
        isSetUp: false,
        isUnlocked: false,
        currentInstanceId: 'instance-1'
      });

      render(<DatabaseTest />);

      // Verify the callback was captured
      expect(capturedInstanceChangeCallback).not.toBeNull();

      // Perform setup to set testResult
      const setupButton = screen.getByTestId('db-setup-button');
      await user.click(setupButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Database setup complete');
      });

      // Simulate instance change event by calling the captured callback
      act(() => {
        capturedInstanceChangeCallback?.();
      });

      // testResult should be reset - since idle has no message,
      // the db-test-result element should not be rendered
      await waitFor(() => {
        expect(screen.queryByTestId('db-test-result')).not.toBeInTheDocument();
      });
    });

    it('clears testData when instance change event is emitted', async () => {
      const user = userEvent.setup();
      const mockExecute = vi.fn().mockResolvedValue({ rows: [] });
      mockGetDatabaseAdapter.mockReturnValue({ execute: mockExecute });
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        currentInstanceId: 'instance-1'
      });

      render(<DatabaseTest />);

      // Verify the callback was captured
      expect(capturedInstanceChangeCallback).not.toBeNull();

      // Write data to set testData
      const writeButton = screen.getByTestId('db-write-button');
      await user.click(writeButton);

      await waitFor(() => {
        expect(screen.getByTestId('db-test-data')).toBeInTheDocument();
      });

      // Simulate instance change event by calling the captured callback
      act(() => {
        capturedInstanceChangeCallback?.();
      });

      // testData should be cleared
      await waitFor(() => {
        expect(screen.queryByTestId('db-test-data')).not.toBeInTheDocument();
      });
    });
  });
});
