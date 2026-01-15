import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InlineUnlock } from './InlineUnlock';

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// Mock the database context
const mockUseDatabaseContext = vi.fn();
vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

// Mock isBiometricAvailable from key-manager
const mockIsBiometricAvailable = vi.fn();
vi.mock('@/db/crypto/key-manager', () => ({
  isBiometricAvailable: () => mockIsBiometricAvailable()
}));

// Mock detectPlatform to return 'web' while preserving other exports
vi.mock('@/lib/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/utils')>();
  return {
    ...actual,
    detectPlatform: () => 'web'
  };
});

describe('InlineUnlock', () => {
  const mockUnlock = vi.fn();
  const mockRestoreSession = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBiometricAvailable.mockResolvedValue({
      isAvailable: false,
      biometryType: null
    });

    // Default mocks for a locked, set-up database
    mockUseDatabaseContext.mockReturnValue({
      isSetUp: true,
      isUnlocked: false,
      hasPersistedSession: false,
      unlock: mockUnlock,
      restoreSession: mockRestoreSession
    });
  });

  describe('when database is not set up', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isSetUp: false,
        isUnlocked: false,
        hasPersistedSession: false,
        unlock: mockUnlock,
        restoreSession: mockRestoreSession
      });
    });

    it('shows not set up message with link to SQLite page', () => {
      renderWithRouter(<InlineUnlock />);

      expect(screen.getByText(/Database is not set up/i)).toBeInTheDocument();
      const link = screen.getByRole('link', { name: 'SQLite page' });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/sqlite');
    });

    it('does not show password input', () => {
      renderWithRouter(<InlineUnlock />);

      expect(
        screen.queryByTestId('inline-unlock-password')
      ).not.toBeInTheDocument();
    });
  });

  describe('when database is locked and set up', () => {
    it('shows locked message with default description', () => {
      renderWithRouter(<InlineUnlock />);

      expect(
        screen.getByText(
          /Database is locked. Enter your password to view content./i
        )
      ).toBeInTheDocument();
    });

    it('shows locked message with custom description', () => {
      renderWithRouter(<InlineUnlock description="files" />);

      expect(
        screen.getByText(
          /Database is locked. Enter your password to view files./i
        )
      ).toBeInTheDocument();
    });

    it('renders password input', () => {
      renderWithRouter(<InlineUnlock />);

      expect(screen.getByTestId('inline-unlock-password')).toBeInTheDocument();
    });

    it('renders unlock button', () => {
      renderWithRouter(<InlineUnlock />);

      expect(screen.getByTestId('inline-unlock-button')).toBeInTheDocument();
    });

    it('shows persist session checkbox on web platform', () => {
      renderWithRouter(<InlineUnlock />);

      expect(screen.getByTestId('inline-unlock-persist')).toBeInTheDocument();
      expect(screen.getByText(/Keep unlocked/i)).toBeInTheDocument();
    });

    it('unlock button is disabled when password is empty', () => {
      renderWithRouter(<InlineUnlock />);

      const unlockButton = screen.getByTestId('inline-unlock-button');
      expect(unlockButton).toBeDisabled();
    });

    it('ignores submit when password is empty', () => {
      renderWithRouter(<InlineUnlock />);

      const form = screen.getByTestId('inline-unlock-button').closest('form');

      if (!form) {
        throw new Error('Unlock form not found');
      }

      fireEvent.submit(form);

      expect(mockUnlock).not.toHaveBeenCalled();
    });

    it('enables unlock button when password is entered', async () => {
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      await user.type(passwordInput, 'testpassword');

      const unlockButton = screen.getByTestId('inline-unlock-button');
      expect(unlockButton).not.toBeDisabled();
    });

    it('calls unlock with password when form is submitted', async () => {
      mockUnlock.mockResolvedValue(true);
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      await user.type(passwordInput, 'testpassword123');

      const unlockButton = screen.getByTestId('inline-unlock-button');
      await user.click(unlockButton);

      expect(mockUnlock).toHaveBeenCalledWith('testpassword123', false);
    });

    it('calls unlock with persist flag when checkbox is checked', async () => {
      mockUnlock.mockResolvedValue(true);
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      const persistCheckbox = screen.getByTestId('inline-unlock-persist');

      await user.type(passwordInput, 'testpassword123');
      await user.click(persistCheckbox);
      await user.click(screen.getByTestId('inline-unlock-button'));

      expect(mockUnlock).toHaveBeenCalledWith('testpassword123', true);
    });

    it('shows error message when unlock fails with wrong password', async () => {
      mockUnlock.mockResolvedValue(false);
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      await user.type(passwordInput, 'wrongpassword');
      await user.click(screen.getByTestId('inline-unlock-button'));

      await waitFor(() => {
        expect(screen.getByTestId('inline-unlock-error')).toHaveTextContent(
          'Wrong password'
        );
      });
    });

    it('shows error message when unlock throws', async () => {
      mockUnlock.mockRejectedValue(new Error('Network error'));
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      await user.type(passwordInput, 'password');
      await user.click(screen.getByTestId('inline-unlock-button'));

      await waitFor(() => {
        expect(screen.getByTestId('inline-unlock-error')).toHaveTextContent(
          'Network error'
        );
      });
    });

    it('clears error when password is changed', async () => {
      mockUnlock.mockResolvedValue(false);
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      await user.type(passwordInput, 'wrong');
      await user.click(screen.getByTestId('inline-unlock-button'));

      await waitFor(() => {
        expect(screen.getByTestId('inline-unlock-error')).toBeInTheDocument();
      });

      // Type more characters to trigger onChange
      await user.type(passwordInput, 'more');

      expect(
        screen.queryByTestId('inline-unlock-error')
      ).not.toBeInTheDocument();
    });
  });

  describe('password visibility toggle', () => {
    it('defaults to password hidden', () => {
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      expect(passwordInput).toHaveAttribute('type', 'password');
    });

    it('toggles password visibility when eye button is clicked', async () => {
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      const toggleButton = screen.getByLabelText('Show password');

      await user.click(toggleButton);

      expect(passwordInput).toHaveAttribute('type', 'text');

      await user.click(screen.getByLabelText('Hide password'));

      expect(passwordInput).toHaveAttribute('type', 'password');
    });
  });

  describe('when session can be restored', () => {
    beforeEach(() => {
      mockUseDatabaseContext.mockReturnValue({
        isSetUp: true,
        isUnlocked: false,
        hasPersistedSession: true,
        unlock: mockUnlock,
        restoreSession: mockRestoreSession
      });
    });

    it('shows restore session button', () => {
      renderWithRouter(<InlineUnlock />);

      expect(screen.getByTestId('inline-unlock-restore')).toBeInTheDocument();
    });

    it('calls restoreSession when restore button is clicked', async () => {
      mockRestoreSession.mockResolvedValue(true);
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      await user.click(screen.getByTestId('inline-unlock-restore'));

      expect(mockRestoreSession).toHaveBeenCalled();
    });

    it('shows error when session restore fails', async () => {
      mockRestoreSession.mockResolvedValue(false);
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      await user.click(screen.getByTestId('inline-unlock-restore'));

      await waitFor(() => {
        expect(screen.getByTestId('inline-unlock-error')).toHaveTextContent(
          'Failed to restore session'
        );
      });
    });
  });

  describe('loading states', () => {
    let resolveUnlock: (value: boolean) => void;

    beforeEach(() => {
      const unlockPromise = new Promise<boolean>((resolve) => {
        resolveUnlock = resolve;
      });
      mockUnlock.mockReturnValue(unlockPromise);
    });

    it('shows loading state when unlocking', async () => {
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      await user.type(passwordInput, 'password');
      await user.click(screen.getByTestId('inline-unlock-button'));

      expect(screen.getByText('Unlocking...')).toBeInTheDocument();

      // Resolve the promise and wait for state update
      resolveUnlock?.(true);
      await waitFor(() => {
        expect(screen.queryByText('Unlocking...')).not.toBeInTheDocument();
      });
    });

    it('disables input and button while loading', async () => {
      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      const passwordInput = screen.getByTestId('inline-unlock-password');
      await user.type(passwordInput, 'password');
      await user.click(screen.getByTestId('inline-unlock-button'));

      expect(passwordInput).toBeDisabled();
      expect(screen.getByTestId('inline-unlock-button')).toBeDisabled();

      // Resolve the promise and wait for state update
      resolveUnlock?.(true);
      await waitFor(() => {
        expect(passwordInput).not.toBeDisabled();
      });
    });
  });

  describe('restore session error handling', () => {
    it('shows error when restoreSession throws an exception', async () => {
      mockRestoreSession.mockRejectedValue(new Error('Session expired'));
      mockUseDatabaseContext.mockReturnValue({
        isSetUp: true,
        isUnlocked: false,
        hasPersistedSession: true,
        unlock: mockUnlock,
        restoreSession: mockRestoreSession
      });

      const user = userEvent.setup();
      renderWithRouter(<InlineUnlock />);

      await user.click(screen.getByTestId('inline-unlock-restore'));

      await waitFor(() => {
        expect(screen.getByTestId('inline-unlock-error')).toHaveTextContent(
          'Session expired'
        );
      });
    });
  });
});

// Note: Mobile biometric flows (lines 40-46, 49-62 in InlineUnlock.tsx) are hard to
// test because the platform is determined at module load time with `detectPlatform()`.
// Testing these would require completely reloading the module with different mocks,
// which adds complexity. The getBiometricLabel function and biometric availability
// check are integration-tested on actual mobile devices.
