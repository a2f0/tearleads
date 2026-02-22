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

vi.mock('@/hooks/app', () => ({
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
