import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DocumentsWindowMenuBar } from './DocumentsWindowMenuBar';

describe('DocumentsWindowMenuBar', () => {
  const defaultProps = {
    onUpload: vi.fn(),
    onRefresh: vi.fn(),
    onClose: vi.fn()
  } satisfies ComponentProps<typeof DocumentsWindowMenuBar>;

  it('renders File menu trigger', () => {
    render(<DocumentsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows Upload, Refresh, and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<DocumentsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Upload' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: 'Refresh' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('calls onUpload when Upload is clicked', async () => {
    const user = userEvent.setup();
    const onUpload = vi.fn();
    render(<DocumentsWindowMenuBar {...defaultProps} onUpload={onUpload} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Upload' }));

    expect(onUpload).toHaveBeenCalledTimes(1);
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<DocumentsWindowMenuBar {...defaultProps} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DocumentsWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
