import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HealthWindowMenuBar } from './HealthWindowMenuBar';

vi.mock('@/hooks/usePreserveWindowState', () => ({
  usePreserveWindowState: () => ({
    preserveWindowState: true,
    setPreserveWindowState: vi.fn()
  })
}));

describe('HealthWindowMenuBar', () => {
  const defaultProps = {
    onRefresh: vi.fn(),
    onClose: vi.fn()
  } satisfies ComponentProps<typeof HealthWindowMenuBar>;

  it('renders File menu trigger', () => {
    render(<HealthWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<HealthWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Refresh and Close options in File menu', async () => {
    const user = userEvent.setup();
    render(<HealthWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Refresh' })
    ).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows Options in View menu', async () => {
    const user = userEvent.setup();
    render(<HealthWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Options' })
    ).toBeInTheDocument();
  });

  it('calls onRefresh when Refresh is clicked', async () => {
    const user = userEvent.setup();
    const onRefresh = vi.fn();
    render(<HealthWindowMenuBar {...defaultProps} onRefresh={onRefresh} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Refresh' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HealthWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
