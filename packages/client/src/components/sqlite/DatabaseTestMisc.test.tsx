import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DatabaseTest } from './DatabaseTest';

const mockUseDatabaseContext = vi.fn();
const mockGetDatabaseAdapter = vi.fn();
const mockSetDatabasePassword = vi.fn();
const mockUpdateInstance = vi.fn();
let capturedInstanceChangeCallback: (() => void) | null = null;

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db', () => ({
  getDatabaseAdapter: () => mockGetDatabaseAdapter(),
  setDatabasePassword: (...args: unknown[]) => mockSetDatabasePassword(...args)
}));

vi.mock('@/db/instanceRegistry', () => ({
  updateInstance: (...args: unknown[]) => mockUpdateInstance(...args)
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

vi.mock('@/contexts/AuthContext', () => ({
  useOptionalAuth: () => null
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
      currentInstanceId: null,
      instances: [],
      setup: vi.fn(),
      unlock: vi.fn(),
      persistSession: vi.fn(),
      clearPersistedSession: vi.fn(),
      lock: vi.fn(),
      reset: vi.fn(),
      changePassword: vi.fn(),
      restoreSession: vi.fn(),
      refreshInstances: vi.fn()
    };
    mockUseDatabaseContext.mockReturnValue({ ...defaults, ...overrides });
    return { ...defaults, ...overrides };
  }

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

      const passwordInput = screen.getByTestId('db-password-input');
      await user.type(passwordInput, 'testpassword');

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

      const passwordInput = screen.getByTestId('db-password-input');
      await user.type(passwordInput, 'testpassword');

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
      await user.type(passwordInput, 'testpassword{enter}');

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
      await user.type(passwordInput, 'testpassword{enter}');

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
      const passwordInput = screen.getByTestId('db-password-input');
      await user.type(passwordInput, 'testpassword');

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

  describe('deferred password', () => {
    it('shows "Password: Not Set" indicator when deferred', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        currentInstanceId: 'inst-1',
        instances: [{ id: 'inst-1', passwordDeferred: true }]
      });

      render(<DatabaseTest />);

      const status = screen.getByTestId('db-password-status');
      expect(status).toHaveTextContent('Not Set');
    });

    it('hides indicator when not deferred', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        currentInstanceId: 'inst-1',
        instances: [{ id: 'inst-1', passwordDeferred: false }]
      });

      render(<DatabaseTest />);

      expect(screen.queryByTestId('db-password-status')).not.toBeInTheDocument();
    });

    it('shows "Set Password" button when unlocked and deferred', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        currentInstanceId: 'inst-1',
        instances: [{ id: 'inst-1', passwordDeferred: true }]
      });

      render(<DatabaseTest />);

      expect(
        screen.getByTestId('db-set-password-button')
      ).toBeInTheDocument();
    });

    it('hides "Set Password" button when not deferred', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        currentInstanceId: 'inst-1',
        instances: [{ id: 'inst-1', passwordDeferred: false }]
      });

      render(<DatabaseTest />);

      expect(
        screen.queryByTestId('db-set-password-button')
      ).not.toBeInTheDocument();
    });

    it('sets password successfully', async () => {
      const user = userEvent.setup();
      const refreshInstances = vi.fn().mockResolvedValue(undefined);
      mockSetDatabasePassword.mockResolvedValue(true);
      mockUpdateInstance.mockResolvedValue(undefined);

      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        currentInstanceId: 'inst-1',
        instances: [{ id: 'inst-1', passwordDeferred: true }],
        refreshInstances
      });

      render(<DatabaseTest />);

      const passwordInput = screen.getByTestId('db-password-input');
      await user.type(passwordInput, 'my-new-pass');

      const setPasswordButton = screen.getByTestId('db-set-password-button');
      await user.click(setPasswordButton);

      await waitFor(() => {
        expect(mockSetDatabasePassword).toHaveBeenCalledWith(
          'my-new-pass',
          'inst-1'
        );
        expect(mockUpdateInstance).toHaveBeenCalledWith('inst-1', {
          passwordDeferred: false
        });
        expect(refreshInstances).toHaveBeenCalled();
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Password set successfully');
        expect(result).toHaveAttribute('data-status', 'success');
      });
    });

    it('disables Set Password button when password is empty', () => {
      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        currentInstanceId: 'inst-1',
        instances: [{ id: 'inst-1', passwordDeferred: true }]
      });

      render(<DatabaseTest />);

      const setPasswordButton = screen.getByTestId('db-set-password-button');
      expect(setPasswordButton).toBeDisabled();
    });

    it('shows error when setDatabasePassword fails', async () => {
      const user = userEvent.setup();
      mockSetDatabasePassword.mockRejectedValue(new Error('Save failed'));

      setupMockContext({
        isSetUp: true,
        isUnlocked: true,
        currentInstanceId: 'inst-1',
        instances: [{ id: 'inst-1', passwordDeferred: true }]
      });

      render(<DatabaseTest />);

      const passwordInput = screen.getByTestId('db-password-input');
      await user.type(passwordInput, 'my-new-pass');

      const setPasswordButton = screen.getByTestId('db-set-password-button');
      await user.click(setPasswordButton);

      await waitFor(() => {
        const result = screen.getByTestId('db-test-result');
        expect(result).toHaveTextContent('Set password error: Save failed');
        expect(result).toHaveAttribute('data-status', 'error');
      });
    });
  });
});
