import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsWindowMenuBar } from './AnalyticsWindowMenuBar';

describe('AnalyticsWindowMenuBar', () => {
  const defaultProps = {
    onClose: vi.fn()
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders File menu trigger', () => {
    render(<AnalyticsWindowMenuBar {...defaultProps} />);
    expect(screen.getByRole('button', { name: 'File' })).toBeInTheDocument();
  });

  it('shows Close option in File menu', async () => {
    const user = userEvent.setup();
    render(<AnalyticsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(screen.getByRole('menuitem', { name: 'Close' })).toBeInTheDocument();
  });

  it('shows Export as CSV option in File menu', async () => {
    const user = userEvent.setup();
    render(
      <AnalyticsWindowMenuBar
        {...defaultProps}
        onExportCsv={vi.fn()}
      />
    );

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Export as CSV' })
    ).toBeInTheDocument();
  });

  it('disables Export as CSV when handler is not provided', async () => {
    const user = userEvent.setup();
    render(<AnalyticsWindowMenuBar {...defaultProps} />);

    await user.click(screen.getByRole('button', { name: 'File' }));

    expect(
      screen.getByRole('menuitem', { name: 'Export as CSV' })
    ).toBeDisabled();
  });

  it('calls onExportCsv when Export as CSV is clicked', async () => {
    const user = userEvent.setup();
    const onExportCsv = vi.fn();
    render(
      <AnalyticsWindowMenuBar
        {...defaultProps}
        onExportCsv={onExportCsv}
      />
    );

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Export as CSV' }));

    expect(onExportCsv).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Close is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<AnalyticsWindowMenuBar {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    await user.click(screen.getByRole('menuitem', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
