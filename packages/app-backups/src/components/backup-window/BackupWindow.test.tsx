import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { BackupWindow } from './BackupWindow';

// Mock BackupManagerView to avoid testing its internals here
vi.mock('./BackupManagerView', () => ({
  BackupManagerView: () => (
    <div data-testid="backup-manager-view">BackupManagerView</div>
  )
}));

vi.mock('./BackupDocumentation', () => ({
  BackupDocumentation: ({ onBack }: { onBack?: (() => void) | undefined }) => (
    <div data-testid="backup-documentation">
      BackupDocumentation
      {onBack && (
        <button type="button" onClick={onBack}>
          Back to Backup Manager
        </button>
      )}
    </div>
  )
}));

describe('BackupWindow', () => {
  const defaultProps = {
    id: 'test-backup-window',
    onClose: vi.fn(),
    onMinimize: vi.fn(),
    onDimensionsChange: vi.fn(),
    onFocus: vi.fn(),
    zIndex: 100,
    initialDimensions: { x: 100, y: 100, width: 400, height: 300 }
  };

  it('renders with title', async () => {
    render(<BackupWindow {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('Backup Manager')).toBeInTheDocument();
    });
  });

  it('renders BackupManagerView inside', async () => {
    render(<BackupWindow {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByTestId('backup-manager-view')).toBeInTheDocument();
    });
  });

  it('renders menu bar', async () => {
    render(<BackupWindow {...defaultProps} />);
    await waitFor(() => {
      // Menu bar renders File, View, and Help menus
      expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Help' })).toBeInTheDocument();
    });
  });

  it('opens documentation view from Help menu', async () => {
    const user = userEvent.setup();
    render(<BackupWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'Documentation' }));

    expect(screen.getByTestId('backup-documentation')).toBeInTheDocument();
    expect(screen.queryByTestId('backup-manager-view')).not.toBeInTheDocument();
  });

  it('renders databaseBlocker instead of content when provided', async () => {
    render(
      <BackupWindow
        {...defaultProps}
        databaseBlocker={
          <div data-testid="database-blocker">Database is not set up</div>
        }
      />
    );
    await waitFor(() => {
      expect(screen.getByTestId('database-blocker')).toBeInTheDocument();
      expect(
        screen.queryByTestId('backup-manager-view')
      ).not.toBeInTheDocument();
    });
  });

  it('returns to manager view from documentation back action', async () => {
    const user = userEvent.setup();
    render(<BackupWindow {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'Help' }));
    await user.click(screen.getByRole('menuitem', { name: 'Documentation' }));
    await user.click(
      screen.getByRole('button', { name: 'Back to Backup Manager' })
    );

    expect(screen.getByTestId('backup-manager-view')).toBeInTheDocument();
    expect(
      screen.queryByTestId('backup-documentation')
    ).not.toBeInTheDocument();
  });
});
