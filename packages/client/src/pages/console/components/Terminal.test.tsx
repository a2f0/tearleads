import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Terminal } from './Terminal';

const mockSetup = vi.fn();
const mockUnlock = vi.fn();
const mockRestoreSession = vi.fn();
const mockLock = vi.fn();
const mockExportDatabase = vi.fn();
const mockImportDatabase = vi.fn();
const mockChangePassword = vi.fn();

const mockContext = {
  isLoading: false,
  isSetUp: false,
  isUnlocked: false,
  hasPersistedSession: false,
  currentInstanceName: 'Default',
  setup: mockSetup,
  unlock: mockUnlock,
  restoreSession: mockRestoreSession,
  lock: mockLock,
  exportDatabase: mockExportDatabase,
  importDatabase: mockImportDatabase,
  changePassword: mockChangePassword
};

vi.mock('@/db/hooks', () => ({
  useDatabaseContext: () => mockContext
}));

vi.mock('@/lib/file-utils', () => ({
  generateBackupFilename: vi.fn(() => 'rapid-backup.db'),
  readFileAsUint8Array: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
  saveFile: vi.fn(() => Promise.resolve())
}));

describe('Terminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockContext.isLoading = false;
    mockContext.isSetUp = false;
    mockContext.isUnlocked = false;
    mockContext.hasPersistedSession = false;
    mockContext.currentInstanceName = 'Default';
    mockSetup.mockResolvedValue(true);
    mockUnlock.mockResolvedValue(true);
    mockRestoreSession.mockResolvedValue(true);
    mockLock.mockResolvedValue(undefined);
    mockExportDatabase.mockResolvedValue(new Uint8Array([1, 2, 3]));
    mockImportDatabase.mockResolvedValue(undefined);
    mockChangePassword.mockResolvedValue(true);
  });

  it('renders terminal with welcome message', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(screen.getByText('Rapid Terminal v1.0')).toBeInTheDocument();
    });
    expect(
      screen.getByText('Type "help" for available commands.')
    ).toBeInTheDocument();
  });

  it('shows prompt', () => {
    render(<Terminal />);

    expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
      'tearleads>'
    );
  });

  it('executes status command', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = false;
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'status{Enter}');

    await waitFor(() => {
      expect(screen.getByText(/Database:.*Locked/)).toBeInTheDocument();
    });
  });

  it('executes help command', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'help{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Available commands:')).toBeInTheDocument();
    });
  });

  it('executes clear command', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    // First add some output
    await user.type(input, 'help{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Available commands:')).toBeInTheDocument();
    });

    // Then clear
    await user.type(input, 'clear{Enter}');

    await waitFor(() => {
      expect(screen.queryByText('Available commands:')).not.toBeInTheDocument();
    });
  });

  it('shows error for unknown command', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unknown{Enter}');

    await waitFor(() => {
      expect(screen.getByText('Unknown command: unknown')).toBeInTheDocument();
    });
  });

  it('handles setup command flow', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'setup{Enter}');

    // Should prompt for password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });

    // Input should be password type
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'type',
      'password'
    );

    // Enter password
    await user.type(screen.getByTestId('terminal-input'), 'secret123{Enter}');

    // Should prompt for confirmation
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Confirm password:'
      );
    });

    // Enter confirmation
    await user.type(screen.getByTestId('terminal-input'), 'secret123{Enter}');

    await waitFor(() => {
      expect(mockSetup).toHaveBeenCalledWith('secret123');
    });
    expect(
      screen.getByText('Database initialized successfully.')
    ).toBeInTheDocument();
  });

  it('handles unlock command flow', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unlock{Enter}');

    // Should prompt for password
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Password:'
      );
    });

    // Enter password
    await user.type(screen.getByTestId('terminal-input'), 'secret123{Enter}');

    await waitFor(() => {
      expect(mockUnlock).toHaveBeenCalledWith('secret123', false);
    });
    expect(screen.getByText('Database unlocked.')).toBeInTheDocument();
  });

  it('handles unlock --persist flag', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'unlock --persist{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Password:'
      );
    });

    await user.type(screen.getByTestId('terminal-input'), 'secret123{Enter}');

    await waitFor(() => {
      expect(mockUnlock).toHaveBeenCalledWith('secret123', true);
    });
    expect(
      screen.getByText('Database unlocked (session persisted).')
    ).toBeInTheDocument();
  });

  it('handles lock command', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'lock{Enter}');

    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(false);
    });
    expect(screen.getByText('Database locked.')).toBeInTheDocument();
  });

  it('handles lock --clear command', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'lock --clear{Enter}');

    await waitFor(() => {
      expect(mockLock).toHaveBeenCalledWith(true);
    });
    expect(
      screen.getByText('Database locked (session cleared).')
    ).toBeInTheDocument();
  });

  it('uses Ctrl+L to clear terminal', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    // Wait for initial content
    await waitFor(() => {
      expect(screen.getByText('Rapid Terminal v1.0')).toBeInTheDocument();
    });

    const input = screen.getByTestId('terminal-input');
    await user.type(input, '{Control>}l{/Control}');

    await waitFor(() => {
      expect(screen.queryByText('Rapid Terminal v1.0')).not.toBeInTheDocument();
    });
  });

  it('uses Ctrl+C to cancel operation', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');

    // Start a multi-step command
    await user.type(input, 'setup{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });

    // Cancel with Ctrl+C
    await user.type(
      screen.getByTestId('terminal-input'),
      '{Control>}c{/Control}'
    );

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'tearleads>'
      );
    });
  });

  it('navigates command history with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');

    // Execute some commands
    await user.type(input, 'status{Enter}');
    await user.type(input, 'help{Enter}');

    // Navigate up
    await user.type(input, '{ArrowUp}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-input')).toHaveValue('help');
    });

    // Navigate up again
    await user.type(input, '{ArrowUp}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-input')).toHaveValue('status');
    });

    // Navigate down
    await user.type(input, '{ArrowDown}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-input')).toHaveValue('help');
    });
  });

  it('hides password input in echo', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'setup{Enter}');

    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'New password:'
      );
    });

    await user.type(screen.getByTestId('terminal-input'), 'secret123{Enter}');

    // Should show masked password in output
    await waitFor(() => {
      expect(screen.getByText(/New password:.*•{8}/)).toBeInTheDocument();
    });
  });

  it('applies custom className', () => {
    render(<Terminal className="custom-class" />);

    expect(screen.getByTestId('terminal')).toHaveClass('custom-class');
  });

  it('does not submit empty input', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');

    // Count initial lines
    const initialOutput = screen.getByTestId('terminal-output');
    const initialLineCount = initialOutput.children.length;

    // Submit empty input
    await user.type(input, '{Enter}');

    // Line count should remain the same
    await waitFor(() => {
      expect(initialOutput.children.length).toBe(initialLineCount);
    });
  });

  it('uses Ctrl+C to clear input without pending command', async () => {
    const user = userEvent.setup();
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');

    // Type something but don't submit
    await user.type(input, 'some partial command');

    expect(input).toHaveValue('some partial command');

    // Press Ctrl+C
    await user.type(input, '{Control>}c{/Control}');

    // Input should be cleared and ^C should appear in output
    await waitFor(() => {
      expect(input).toHaveValue('');
    });
    expect(screen.getByText('^C')).toBeInTheDocument();
  });

  it('echoes confirm mode input (non-password)', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    render(<Terminal />);

    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'restore{Enter}');

    // Wait for file picker prompt
    await waitFor(() => {
      expect(screen.getByText('Select a backup file...')).toBeInTheDocument();
    });

    // Simulate file selection
    const fileInput = screen.getByTestId('terminal-file-input');
    const file = new File(['test content'], 'test.db', {
      type: 'application/octet-stream'
    });
    await user.upload(fileInput, file);

    // Should prompt for confirmation
    await waitFor(() => {
      expect(screen.getByTestId('terminal-prompt')).toHaveTextContent(
        'Continue? (y/n):'
      );
    });

    // Input should be text type (not password)
    expect(screen.getByTestId('terminal-input')).toHaveAttribute(
      'type',
      'text'
    );

    // Enter confirmation
    await user.type(screen.getByTestId('terminal-input'), 'y{Enter}');

    // Should echo the input (not masked like password)
    await waitFor(() => {
      expect(screen.getByText(/Continue\? \(y\/n\):.*y/)).toBeInTheDocument();
    });
  });

  it('handles file input change', async () => {
    const user = userEvent.setup();
    mockContext.isSetUp = true;
    mockContext.isUnlocked = true;
    render(<Terminal />);

    // Start restore flow
    const input = screen.getByTestId('terminal-input');
    await user.type(input, 'restore --force{Enter}');

    // Simulate file selection
    const fileInput = screen.getByTestId('terminal-file-input');
    const file = new File(['test content'], 'test.db', {
      type: 'application/octet-stream'
    });

    await user.upload(fileInput, file);

    // Should complete restore
    await waitFor(() => {
      expect(mockImportDatabase).toHaveBeenCalled();
    });
  });
});
