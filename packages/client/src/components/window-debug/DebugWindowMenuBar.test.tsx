import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DebugWindowMenuBar } from './DebugWindowMenuBar';

vi.mock('@tearleads/window-manager', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@tearleads/window-manager')>();

  return {
    ...actual,
    WindowControlBar: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="window-control-bar">{children}</div>
    )
  };
});

describe('DebugWindowMenuBar', () => {
  const defaultProps = {
    onClose: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders File menu trigger', () => {
    render(<DebugWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows Close option in File menu', async () => {
    const user = userEvent.setup();
    render(<DebugWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('renders View menu trigger', () => {
    render(<DebugWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'View' })).toBeInTheDocument();
  });

  it('shows Options in View menu', async () => {
    const user = userEvent.setup();
    render(<DebugWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'View' }));

    expect(
      screen.getByRole('menuitem', { name: 'Options' })
    ).toBeInTheDocument();
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DebugWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders the control bar', () => {
    render(<DebugWindowMenuBar {...defaultProps} />);
    expect(screen.getByTestId('window-control-bar')).toBeInTheDocument();
  });

  it('renders controls inside the control bar', () => {
    render(
      <DebugWindowMenuBar
        {...defaultProps}
        controls={<button type="button">Back</button>}
      />
    );
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });
});
