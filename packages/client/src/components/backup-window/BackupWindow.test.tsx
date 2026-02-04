import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BackupWindow } from './BackupWindow';

// Mock the child components to avoid testing their internals here
vi.mock('./CreateBackupTab', () => ({
  CreateBackupTab: () => <div data-testid="create-backup-tab">Create Tab</div>
}));

vi.mock('./RestoreBackupTab', () => ({
  RestoreBackupTab: () => (
    <div data-testid="restore-backup-tab">Restore Tab</div>
  )
}));

vi.mock('./StoredBackupsTab', () => ({
  StoredBackupsTab: () => <div data-testid="stored-backup-tab">Stored Tab</div>
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

  it('renders with title', () => {
    render(<BackupWindow {...defaultProps} />);
    expect(screen.getByText('Backup Manager')).toBeInTheDocument();
  });

  it('shows Create tab by default', () => {
    render(<BackupWindow {...defaultProps} />);
    expect(screen.getByTestId('create-backup-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('restore-backup-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stored-backup-tab')).not.toBeInTheDocument();
  });

  it('switches to Restore tab when clicked', () => {
    render(<BackupWindow {...defaultProps} />);

    // Find and click the Restore tab button
    const restoreButton = screen.getByRole('tab', { name: /restore/i });
    fireEvent.click(restoreButton);

    expect(screen.queryByTestId('create-backup-tab')).not.toBeInTheDocument();
    expect(screen.getByTestId('restore-backup-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('stored-backup-tab')).not.toBeInTheDocument();
  });

  it('switches back to Create tab', () => {
    render(<BackupWindow {...defaultProps} />);

    // Switch to Restore
    const restoreButton = screen.getByRole('tab', { name: /restore/i });
    fireEvent.click(restoreButton);

    // Switch back to Create
    const createButton = screen.getByRole('tab', { name: /create/i });
    fireEvent.click(createButton);

    expect(screen.getByTestId('create-backup-tab')).toBeInTheDocument();
    expect(screen.queryByTestId('restore-backup-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stored-backup-tab')).not.toBeInTheDocument();
  });

  it('switches to Stored tab', () => {
    render(<BackupWindow {...defaultProps} />);

    const storedButton = screen.getByRole('tab', { name: /stored/i });
    fireEvent.click(storedButton);

    expect(screen.queryByTestId('create-backup-tab')).not.toBeInTheDocument();
    expect(screen.queryByTestId('restore-backup-tab')).not.toBeInTheDocument();
    expect(screen.getByTestId('stored-backup-tab')).toBeInTheDocument();
  });

  it('highlights active tab', () => {
    render(<BackupWindow {...defaultProps} />);

    const createButton = screen.getByRole('tab', { name: /create/i });
    const restoreButton = screen.getByRole('tab', { name: /restore/i });
    const storedButton = screen.getByRole('tab', { name: /stored/i });

    // Create tab should be active by default
    expect(createButton).toHaveAttribute('aria-selected', 'true');
    expect(restoreButton).toHaveAttribute('aria-selected', 'false');
    expect(storedButton).toHaveAttribute('aria-selected', 'false');

    // Switch to Restore
    fireEvent.click(restoreButton);

    expect(createButton).toHaveAttribute('aria-selected', 'false');
    expect(restoreButton).toHaveAttribute('aria-selected', 'true');
    expect(storedButton).toHaveAttribute('aria-selected', 'false');
  });
});
