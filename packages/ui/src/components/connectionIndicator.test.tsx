import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ConnectionIndicator } from './connectionIndicator';
import { TooltipProvider } from './tooltip';

function renderWithProvider(ui: React.ReactNode) {
  return render(<TooltipProvider delayDuration={0}>{ui}</TooltipProvider>);
}

describe('ConnectionIndicator', () => {
  it('renders connected state with green color', () => {
    renderWithProvider(<ConnectionIndicator state="connected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('bg-success');
  });

  it('renders connecting state with pulse animation', () => {
    renderWithProvider(<ConnectionIndicator state="connecting" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('animate-pulse', 'bg-muted-foreground');
  });

  it('renders disconnected state with red color', () => {
    renderWithProvider(<ConnectionIndicator state="disconnected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('bg-destructive');
  });

  it('has accessible label for connected state', () => {
    renderWithProvider(<ConnectionIndicator state="connected" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Connection status: connected'
    );
  });

  it('has accessible label for connecting state', () => {
    renderWithProvider(<ConnectionIndicator state="connecting" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Connection status: connecting'
    );
  });

  it('has accessible label for disconnected state', () => {
    renderWithProvider(<ConnectionIndicator state="disconnected" />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Connection status: disconnected'
    );
  });

  it('applies custom className', () => {
    renderWithProvider(
      <ConnectionIndicator state="connected" className="custom-class" />
    );
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('custom-class');
  });

  it('has correct base styles', () => {
    renderWithProvider(<ConnectionIndicator state="connected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveClass('inline-block', 'h-2', 'w-2', 'rounded-full');
  });

  it.each([
    { state: 'connected' as const, expected: 'SSE: Connected' },
    { state: 'connecting' as const, expected: 'SSE: Connecting' },
    { state: 'disconnected' as const, expected: 'SSE: Disconnected' }
  ])('shows tooltip for $state state on hover', async ({ state, expected }) => {
    const user = userEvent.setup();
    renderWithProvider(<ConnectionIndicator state={state} />);

    await user.hover(screen.getByRole('status'));

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent(expected);
    });
  });

  it('uses custom tooltip when provided', async () => {
    const user = userEvent.setup();
    renderWithProvider(
      <ConnectionIndicator state="connected" tooltip="Custom Tooltip" />
    );

    await user.hover(screen.getByRole('status'));

    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('Custom Tooltip');
    });
  });
});
