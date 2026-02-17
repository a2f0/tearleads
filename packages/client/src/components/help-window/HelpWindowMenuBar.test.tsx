import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HelpWindowMenuBar } from './HelpWindowMenuBar';

describe('HelpWindowMenuBar', () => {
  it('renders File and View menu triggers', () => {
    render(<HelpWindowMenuBar onClose={vi.fn()} />);
    expect(screen.getByText('File')).toBeInTheDocument();
    expect(screen.getByText('View')).toBeInTheDocument();
  });

  it('calls onClose from File -> Close', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<HelpWindowMenuBar onClose={onClose} />);

    await user.click(screen.getByText('File'));
    await user.click(screen.getByText('Close'));
    expect(onClose).toHaveBeenCalled();
  });
});
