import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SSEConnectionDialog } from './SSEConnectionDialog';

vi.mock('@/lib/api', () => ({
  API_BASE_URL: 'https://api.example.com'
}));

describe('SSEConnectionDialog', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <SSEConnectionDialog
        isOpen={false}
        onClose={() => {}}
        connectionState="connected"
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders dialog when open', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="connected"
      />
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Connection Details')).toBeInTheDocument();
  });

  it.each([
    ['connected', 'Connected'],
    ['connecting', 'Connecting...'],
    ['disconnected', 'Disconnected']
  ] as const)('displays %s state correctly', (connectionState, expectedText) => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState={connectionState}
      />
    );
    expect(screen.getByText(expectedText)).toBeInTheDocument();
  });

  it('displays server URL', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="connected"
      />
    );
    expect(screen.getByText('https://api.example.com')).toBeInTheDocument();
  });

  it('displays endpoint', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="connected"
      />
    );
    expect(screen.getByText('/sse')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={onClose}
        connectionState="connected"
      />
    );

    await user.click(screen.getByRole('button', { name: /close dialog/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={onClose}
        connectionState="connected"
      />
    );

    await user.click(screen.getByTestId('sse-dialog-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when Escape key is pressed', () => {
    const onClose = vi.fn();
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={onClose}
        connectionState="connected"
      />
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call onClose for other keys', () => {
    const onClose = vi.fn();
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={onClose}
        connectionState="connected"
      />
    );

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('focuses close button when dialog opens', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="connected"
      />
    );

    expect(screen.getByRole('button', { name: /close dialog/i })).toHaveFocus();
  });

  it('traps focus on Tab when only one focusable element exists', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="connected"
      />
    );

    const closeButton = screen.getByRole('button', { name: /close dialog/i });
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: 'Tab' });
    expect(closeButton).toHaveFocus();
  });

  it('traps focus on Shift+Tab when only one focusable element exists', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="connected"
      />
    );

    const closeButton = screen.getByRole('button', { name: /close dialog/i });
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true });
    expect(closeButton).toHaveFocus();
  });
});
