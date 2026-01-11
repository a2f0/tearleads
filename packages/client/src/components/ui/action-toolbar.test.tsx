import { ThemeProvider } from '@rapid/ui';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActionToolbar } from './action-toolbar';

function renderToolbar(props: Parameters<typeof ActionToolbar>[0] = {}) {
  return render(
    <ThemeProvider>
      <ActionToolbar {...props} />
    </ThemeProvider>
  );
}

describe('ActionToolbar', () => {
  describe('button rendering', () => {
    it('renders download button when onDownload is provided', () => {
      renderToolbar({ onDownload: vi.fn() });
      expect(screen.getByTestId('download-button')).toBeInTheDocument();
    });

    it('does not render download button when onDownload is not provided', () => {
      renderToolbar({});
      expect(screen.queryByTestId('download-button')).not.toBeInTheDocument();
    });

    it('renders share button when onShare is provided and canShare is true', () => {
      renderToolbar({ onShare: vi.fn(), canShare: true });
      expect(screen.getByTestId('share-button')).toBeInTheDocument();
    });

    it('does not render share button when canShare is false', () => {
      renderToolbar({ onShare: vi.fn(), canShare: false });
      expect(screen.queryByTestId('share-button')).not.toBeInTheDocument();
    });

    it('renders delete button when onDelete is provided', () => {
      renderToolbar({ onDelete: vi.fn() });
      expect(screen.getByTestId('delete-button')).toBeInTheDocument();
    });

    it('does not render delete button when onDelete is not provided', () => {
      renderToolbar({});
      expect(screen.queryByTestId('delete-button')).not.toBeInTheDocument();
    });
  });

  describe('button interactions', () => {
    it('calls onDownload when download button is clicked', async () => {
      const user = userEvent.setup();
      const onDownload = vi.fn();
      renderToolbar({ onDownload });

      await user.click(screen.getByTestId('download-button'));
      expect(onDownload).toHaveBeenCalled();
    });

    it('calls onShare when share button is clicked', async () => {
      const user = userEvent.setup();
      const onShare = vi.fn();
      renderToolbar({ onShare, canShare: true });

      await user.click(screen.getByTestId('share-button'));
      expect(onShare).toHaveBeenCalled();
    });

    it('calls onDelete when delete button is clicked', async () => {
      const user = userEvent.setup();
      const onDelete = vi.fn();
      renderToolbar({ onDelete });

      await user.click(screen.getByTestId('delete-button'));
      expect(onDelete).toHaveBeenCalled();
    });
  });

  describe('loading states', () => {
    it('disables all buttons when loadingAction is set', () => {
      renderToolbar({
        onDownload: vi.fn(),
        onShare: vi.fn(),
        onDelete: vi.fn(),
        canShare: true,
        loadingAction: 'download'
      });

      expect(screen.getByTestId('download-button')).toBeDisabled();
      expect(screen.getByTestId('share-button')).toBeDisabled();
      expect(screen.getByTestId('delete-button')).toBeDisabled();
    });

    it('disables all buttons when disabled prop is true', () => {
      renderToolbar({
        onDownload: vi.fn(),
        onShare: vi.fn(),
        onDelete: vi.fn(),
        canShare: true,
        disabled: true
      });

      expect(screen.getByTestId('download-button')).toBeDisabled();
      expect(screen.getByTestId('share-button')).toBeDisabled();
      expect(screen.getByTestId('delete-button')).toBeDisabled();
    });
  });

  describe('accessibility', () => {
    it('has accessible labels on all buttons', () => {
      renderToolbar({
        onDownload: vi.fn(),
        onShare: vi.fn(),
        onDelete: vi.fn(),
        canShare: true
      });

      expect(screen.getByTestId('download-button')).toHaveAttribute(
        'aria-label',
        'Download'
      );
      expect(screen.getByTestId('share-button')).toHaveAttribute(
        'aria-label',
        'Share'
      );
      expect(screen.getByTestId('delete-button')).toHaveAttribute(
        'aria-label',
        'Delete'
      );
    });

    it('has title attributes for tooltips', () => {
      renderToolbar({
        onDownload: vi.fn(),
        onShare: vi.fn(),
        onDelete: vi.fn(),
        canShare: true
      });

      expect(screen.getByTestId('download-button')).toHaveAttribute(
        'title',
        'Download'
      );
      expect(screen.getByTestId('share-button')).toHaveAttribute(
        'title',
        'Share'
      );
      expect(screen.getByTestId('delete-button')).toHaveAttribute(
        'title',
        'Delete'
      );
    });
  });
});
