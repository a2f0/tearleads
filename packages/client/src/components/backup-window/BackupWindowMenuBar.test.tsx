import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackupWindowMenuBar } from './BackupWindowMenuBar';

describe('BackupWindowMenuBar', () => {
  it('renders File menu', () => {
    render(<BackupWindowMenuBar onClose={vi.fn()} />);
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const onClose = vi.fn();
    render(<BackupWindowMenuBar onClose={onClose} />);

    fireEvent.click(screen.getByText('File'));
    fireEvent.click(screen.getByText('Close'));

    expect(onClose).toHaveBeenCalled();
  });
});
