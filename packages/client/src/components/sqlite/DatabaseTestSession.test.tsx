import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTest } from './DatabaseTest';

const mockUseDatabaseContext = vi.fn();
const mockGetDatabaseAdapter = vi.fn();
let _capturedInstanceChangeCallback: (() => void) | null = null;

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db', () => ({
  getDatabaseAdapter: () => mockGetDatabaseAdapter()
}));

vi.mock('@/hooks/app', () => ({
  useOnInstanceChange: (callback: () => void) => {
    _capturedInstanceChangeCallback = callback;
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
      persistSession: vi.fn(),
      clearPersistedSession: vi.fn(),
      lock: vi.fn(),
      reset: vi.fn(),
      changePassword: vi.fn(),
      restoreSession: vi.fn()
    };
    mockUseDatabaseContext.mockReturnValue({ ...defaults, ...overrides });
    return { ...defaults, ...overrides };
  }

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

  describe('persist session toggle', () => {
    it('persists session when checked while unlocked', async () => {
      const user = userEvent.setup();
      const persistSession = vi.fn().mockResolvedValue(true);
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        hasPersistedSession: false,
        persistSession
      });

      render(<DatabaseTest />);

      const persistCheckbox = screen.getByTestId('db-persist-session-checkbox');
      await user.click(persistCheckbox);

      await waitFor(() => {
        expect(persistSession).toHaveBeenCalled();
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Session persisted');
      });
    });

    it('clears persisted session when unchecked while unlocked', async () => {
      const user = userEvent.setup();
      const clearPersistedSession = vi.fn().mockResolvedValue(undefined);
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        hasPersistedSession: true,
        clearPersistedSession
      });

      render(<DatabaseTest />);

      const persistCheckbox = screen.getByTestId('db-persist-session-checkbox');
      await user.click(persistCheckbox);

      await waitFor(() => {
        expect(clearPersistedSession).toHaveBeenCalled();
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Session cleared');
      });
    });

    it('shows error when persist session fails', async () => {
      const user = userEvent.setup();
      const persistSession = vi.fn().mockResolvedValue(false);
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        hasPersistedSession: false,
        persistSession
      });

      render(<DatabaseTest />);

      const persistCheckbox = screen.getByTestId('db-persist-session-checkbox');
      await user.click(persistCheckbox);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Failed to persist session');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });

    it('shows error when clearing session fails', async () => {
      const user = userEvent.setup();
      const clearPersistedSession = vi
        .fn()
        .mockRejectedValue(new Error('Clear failed'));
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        hasPersistedSession: true,
        clearPersistedSession
      });

      render(<DatabaseTest />);

      const persistCheckbox = screen.getByTestId('db-persist-session-checkbox');
      await user.click(persistCheckbox);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Clear session error: Clear failed');
        expect(result).toHaveAttribute('data-status', 'error');
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
});
