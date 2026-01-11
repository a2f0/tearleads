import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from './dialog.js';

describe('Dialog', () => {
  it('renders when open is true', () => {
    render(
      <Dialog open={true} onOpenChange={() => {}} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Test Dialog')).toBeInTheDocument();
    expect(screen.getByText('Dialog content')).toBeInTheDocument();
  });

  it('does not render when open is false', () => {
    render(
      <Dialog open={false} onOpenChange={() => {}} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('calls onOpenChange when backdrop is clicked', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open={true} onOpenChange={onOpenChange} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    fireEvent.click(screen.getByTestId('dialog-backdrop'));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange when Escape key is pressed', () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open={true} onOpenChange={onOpenChange} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders without title when not provided', () => {
    render(
      <Dialog open={true} onOpenChange={() => {}}>
        <p>Dialog content</p>
      </Dialog>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('animates out when closed', async () => {
    const { rerender } = render(
      <Dialog open={true} onOpenChange={() => {}} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();

    rerender(
      <Dialog open={false} onOpenChange={() => {}} title="Test Dialog">
        <p>Dialog content</p>
      </Dialog>
    );

    await waitFor(
      () => {
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      },
      { timeout: 500 }
    );
  });
});
