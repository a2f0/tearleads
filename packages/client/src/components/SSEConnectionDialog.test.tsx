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

  it('displays connected state correctly', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="connected"
      />
    );
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('displays connecting state correctly', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="connecting"
      />
    );
    expect(screen.getByText('Connecting...')).toBeInTheDocument();
  });

  it('displays disconnected state correctly', () => {
    render(
      <SSEConnectionDialog
        isOpen={true}
        onClose={() => {}}
        connectionState="disconnected"
      />
    );
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
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

    fireEvent.keyDown(document, { key: 'Escape' });
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

    fireEvent.keyDown(document, { key: 'Enter' });
    expect(onClose).not.toHaveBeenCalled();
  });
});
