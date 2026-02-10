import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WindowConnectionIndicator } from './WindowConnectionIndicator.js';

describe('WindowConnectionIndicator', () => {
  it('renders indicator with state label', () => {
    render(
      <WindowConnectionIndicator state="connected" tooltip="SSE: Connected" />
    );

    const indicator = screen.getByLabelText('Connection status: connected');
    expect(indicator).toHaveClass('translate-y-1');
    expect(indicator).toHaveClass('bg-success');
  });

  it('shows tooltip on hover', async () => {
    const user = userEvent.setup();
    render(
      <WindowConnectionIndicator state="connected" tooltip="SSE: Connected" />
    );

    await user.hover(screen.getByLabelText('Connection status: connected'));
    await waitFor(() => {
      expect(screen.getByRole('tooltip')).toHaveTextContent('SSE: Connected');
    });
  });

  it('calls onContextMenu when right-clicking wrapper', () => {
    const onContextMenu = vi.fn();

    render(
      <WindowConnectionIndicator
        state="connecting"
        tooltip="SSE: Connecting"
        onContextMenu={onContextMenu}
      />
    );

    const wrapper = screen.getByLabelText(
      'Connection status: connecting'
    ).parentElement;
    expect(wrapper).not.toBeNull();
    if (wrapper instanceof HTMLDivElement) {
      fireEvent.contextMenu(wrapper);
    }
    expect(onContextMenu).toHaveBeenCalledOnce();
  });

  it('applies custom classes', () => {
    render(
      <WindowConnectionIndicator
        state="disconnected"
        tooltip="SSE: Disconnected"
        className="wrapper-class"
        indicatorClassName="indicator-class"
      />
    );

    const indicator = screen.getByLabelText('Connection status: disconnected');
    expect(indicator.parentElement).toHaveClass('wrapper-class');
    expect(indicator).toHaveClass('indicator-class');
  });
});
