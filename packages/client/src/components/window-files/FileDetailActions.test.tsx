import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileDetailActions } from './FileDetailActions';

describe('FileDetailActions', () => {
  it('renders download action and optional share action', () => {
    const { rerender } = render(
      <FileDetailActions
        actionLoading={null}
        canShare={false}
        onDownload={vi.fn()}
        onShare={vi.fn()}
      />
    );

    expect(screen.getByTestId('window-file-download')).toBeInTheDocument();
    expect(screen.queryByTestId('window-file-share')).not.toBeInTheDocument();

    rerender(
      <FileDetailActions
        actionLoading={null}
        canShare
        onDownload={vi.fn()}
        onShare={vi.fn()}
      />
    );

    expect(screen.getByTestId('window-file-share')).toBeInTheDocument();
  });

  it('calls download and share handlers', async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    const onShare = vi.fn();

    render(
      <FileDetailActions
        actionLoading={null}
        canShare
        onDownload={onDownload}
        onShare={onShare}
      />
    );

    await user.click(screen.getByTestId('window-file-download'));
    await user.click(screen.getByTestId('window-file-share'));

    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(onShare).toHaveBeenCalledTimes(1);
  });

  it('disables actions while loading', () => {
    render(
      <FileDetailActions
        actionLoading="download"
        canShare
        onDownload={vi.fn()}
        onShare={vi.fn()}
      />
    );

    expect(screen.getByTestId('window-file-download')).toBeDisabled();
    expect(screen.getByTestId('window-file-share')).toBeDisabled();
  });
});
