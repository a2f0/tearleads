import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { VideoWindowMenuBar } from './VideoWindowMenuBar';

describe('VideoWindowMenuBar', () => {
  const defaultProps = {
    viewMode: 'list',
    onViewModeChange: vi.fn(),
    onClose: vi.fn()
  } satisfies ComponentProps<typeof VideoWindowMenuBar>;

  it('renders the File and View menu triggers', () => {
    render(<VideoWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Close option in the File menu', async () => {
    const user = userEvent.setup();
    render(<VideoWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows List and Table options in the View menu', async () => {
    const user = userEvent.setup();
    render(<VideoWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(screen.getByRole('menuitem', { name: 'List' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Table' })).toBeInTheDocument();
  });

  it('calls onViewModeChange when List is selected', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <VideoWindowMenuBar
        {...defaultProps}
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'List' }));

    expect(onViewModeChange).toHaveBeenCalledWith('list');
  });

  it('calls onViewModeChange when Table is selected', async () => {
    const user = userEvent.setup();
    const onViewModeChange = vi.fn();
    render(
      <VideoWindowMenuBar
        {...defaultProps}
        onViewModeChange={onViewModeChange}
      />
    );

    await user.click(screen.getByRole('button', { name: 'View' }));
    await user.click(screen.getByRole('menuitem', { name: 'Table' }));

    expect(onViewModeChange).toHaveBeenCalledWith('table');
  });

  it('calls onClose when Close is selected', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<VideoWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalled();
  });
});
