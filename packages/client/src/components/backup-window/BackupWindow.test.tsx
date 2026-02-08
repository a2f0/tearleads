import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BackupWindow } from './BackupWindow';

// Mock BackupManagerView to avoid testing its internals here
vi.mock('./BackupManagerView', () => ({
  BackupManagerView: () => (
    <div data-testid="backup-manager-view">BackupManagerView</div>
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
      // Menu bar renders File and View menus
      expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
    });
  });
});
