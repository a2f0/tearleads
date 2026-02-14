import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileDetailHeader } from './FileDetailHeader';

describe('FileDetailHeader', () => {
  it('renders back button and optional delete button', () => {
    render(
      <FileDetailHeader
        canDelete
        onBack={vi.fn()}
        onDeleteRequest={vi.fn()}
        actionsDisabled={false}
      />
    );

    expect(screen.getByTestId('window-file-back')).toBeInTheDocument();
    expect(screen.getByTestId('window-file-delete')).toBeInTheDocument();
  });

  it('hides delete button when canDelete is false', () => {
    render(
      <FileDetailHeader
        canDelete={false}
        onBack={vi.fn()}
        onDeleteRequest={vi.fn()}
        actionsDisabled={false}
      />
    );

    expect(screen.getByTestId('window-file-back')).toBeInTheDocument();
    expect(screen.queryByTestId('window-file-delete')).not.toBeInTheDocument();
  });

  it('calls onBack and onDeleteRequest when clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    const onDeleteRequest = vi.fn();

    render(
      <FileDetailHeader
        canDelete
        onBack={onBack}
        onDeleteRequest={onDeleteRequest}
        actionsDisabled={false}
      />
    );

    await user.click(screen.getByTestId('window-file-back'));
    await user.click(screen.getByTestId('window-file-delete'));

    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onDeleteRequest).toHaveBeenCalledTimes(1);
  });
});
