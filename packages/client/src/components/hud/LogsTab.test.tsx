import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { logStore } from '@/stores/logStore';
import { LogsTab } from './LogsTab';

describe('LogsTab', () => {
  beforeEach(async () => {
    await act(async () => {
      logStore.clearLogs();
    });
  });

  afterEach(async () => {
    await act(async () => {
      logStore.clearLogs();
    });
  });

  it('shows empty state when no logs', async () => {
    await act(async () => {
      render(<LogsTab />);
    });
    expect(screen.getByText(/no logs yet/i)).toBeInTheDocument();
  });

  it('displays logs when present', async () => {
    await act(async () => {
      logStore.info('Test message');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    expect(screen.getByText('Test message')).toBeInTheDocument();
    expect(screen.getByText('info')).toBeInTheDocument();
  });

  it('shows log count', async () => {
    await act(async () => {
      logStore.info('Log 1');
      logStore.error('Log 2');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    expect(screen.getByText('2 logs')).toBeInTheDocument();
  });

  it('shows singular log text for one log', async () => {
    await act(async () => {
      logStore.warn('Only log');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    expect(screen.getByText('1 log')).toBeInTheDocument();
  });

  it('clears logs when clear button clicked', async () => {
    const user = userEvent.setup();
    await act(async () => {
      logStore.info('Test log');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    expect(screen.getByText('Test log')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /clear logs/i }));

    expect(screen.getByText(/no logs yet/i)).toBeInTheDocument();
  });

  it('expands details when log with details is clicked', async () => {
    const user = userEvent.setup();
    await act(async () => {
      logStore.error('Error message', 'Stack trace here');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    expect(screen.queryByText('Stack trace here')).not.toBeInTheDocument();

    await user.click(screen.getByText('Error message'));

    expect(screen.getByText('Stack trace here')).toBeInTheDocument();
  });

  it('collapses details when expanded log is clicked again', async () => {
    const user = userEvent.setup();
    await act(async () => {
      logStore.error('Error message', 'Stack trace here');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    await user.click(screen.getByText('Error message'));
    expect(screen.getByText('Stack trace here')).toBeInTheDocument();

    await user.click(screen.getByText('Error message'));
    expect(screen.queryByText('Stack trace here')).not.toBeInTheDocument();
  });

  it('applies correct color for error level', async () => {
    await act(async () => {
      logStore.error('Error log');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    const levelElement = screen.getByText('error');
    expect(levelElement).toHaveClass('text-red-500');
  });

  it('applies correct color for warn level', async () => {
    await act(async () => {
      logStore.warn('Warning log');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    const levelElement = screen.getByText('warn');
    expect(levelElement).toHaveClass('text-yellow-500');
  });

  it('applies correct color for info level', async () => {
    await act(async () => {
      logStore.info('Info log');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    const levelElement = screen.getByText('info');
    expect(levelElement).toHaveClass('text-blue-500');
  });

  it('applies correct color for debug level', async () => {
    await act(async () => {
      logStore.debug('Debug log');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    const levelElement = screen.getByText('debug');
    expect(levelElement).toHaveClass('text-muted-foreground');
  });

  it('expands details when Enter key is pressed', async () => {
    await act(async () => {
      logStore.error('Error message', 'Stack trace here');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    expect(screen.queryByText('Stack trace here')).not.toBeInTheDocument();

    const logButton = screen.getByRole('button', { name: /error message/i });
    logButton.focus();
    await act(async () => {
      logButton.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
    });

    expect(screen.getByText('Stack trace here')).toBeInTheDocument();
  });

  it('expands details when Space key is pressed', async () => {
    await act(async () => {
      logStore.error('Error message', 'Stack trace here');
    });
    await act(async () => {
      render(<LogsTab />);
    });

    expect(screen.queryByText('Stack trace here')).not.toBeInTheDocument();

    const logButton = screen.getByRole('button', { name: /error message/i });
    logButton.focus();
    await act(async () => {
      logButton.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true })
      );
    });

    expect(screen.getByText('Stack trace here')).toBeInTheDocument();
  });
});
