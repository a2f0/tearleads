import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ANIMATION_DURATION_MS, BottomSheet } from './BottomSheet';

describe('BottomSheet', () => {
  it('renders nothing when not open', () => {
    render(
      <BottomSheet open={false} onOpenChange={() => {}}>
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.queryByTestId('bottom-sheet')).not.toBeInTheDocument();
  });

  it('renders content when open', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}}>
        <p>Sheet content</p>
      </BottomSheet>
    );

    expect(screen.getByTestId('bottom-sheet')).toBeInTheDocument();
    expect(screen.getByText('Sheet content')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}} title="Test Title">
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.getByText('Test Title')).toBeInTheDocument();
  });

  it('does not render title when not provided', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}}>
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('calls onOpenChange with false when backdrop clicked', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <BottomSheet open={true} onOpenChange={onOpenChange}>
        <p>Content</p>
      </BottomSheet>
    );

    await user.click(screen.getByTestId('bottom-sheet-backdrop'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('calls onOpenChange with false when Escape pressed', async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();

    render(
      <BottomSheet open={true} onOpenChange={onOpenChange}>
        <p>Content</p>
      </BottomSheet>
    );

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('has correct accessibility attributes', () => {
    render(
      <BottomSheet open={true} onOpenChange={() => {}} title="Accessible Title">
        <p>Content</p>
      </BottomSheet>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog.getAttribute('aria-labelledby')).toBeTruthy();
  });

  it('uses custom data-testid when provided', () => {
    render(
      <BottomSheet
        open={true}
        onOpenChange={() => {}}
        data-testid="custom-sheet"
      >
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.getByTestId('custom-sheet')).toBeInTheDocument();
    expect(screen.getByTestId('custom-sheet-backdrop')).toBeInTheDocument();
    expect(screen.getByTestId('custom-sheet-content')).toBeInTheDocument();
  });

  it('unmounts after close animation', async () => {
    const { rerender } = render(
      <BottomSheet open={true} onOpenChange={() => {}}>
        <p>Content</p>
      </BottomSheet>
    );

    expect(screen.getByTestId('bottom-sheet')).toBeInTheDocument();

    rerender(
      <BottomSheet open={false} onOpenChange={() => {}}>
        <p>Content</p>
      </BottomSheet>
    );

    await waitFor(
      () => {
        expect(screen.queryByTestId('bottom-sheet')).not.toBeInTheDocument();
      },
      { timeout: ANIMATION_DURATION_MS + 100 }
    );
  });
});
