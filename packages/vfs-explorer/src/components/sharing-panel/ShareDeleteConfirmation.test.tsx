import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ShareDeleteConfirmation } from './ShareDeleteConfirmation';

vi.mock('../../context', () => ({
  useVfsExplorerContext: () => ({
    ui: {
      Button: ({
        children,
        ...props
      }: {
        children: ReactNode;
        [key: string]: unknown;
      }) => <button {...props}>{children}</button>
    }
  })
}));

describe('ShareDeleteConfirmation', () => {
  it('displays target name in confirmation message', () => {
    render(
      <ShareDeleteConfirmation
        targetName="Jane Doe"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText(/Jane Doe/)).toBeInTheDocument();
    expect(
      screen.getByText('They will no longer be able to view this item.')
    ).toBeInTheDocument();
  });

  it('calls onCancel when Cancel is clicked', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(
      <ShareDeleteConfirmation
        targetName="Jane Doe"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />
    );

    await user.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();
  });

  it('calls onConfirm when Remove is clicked', async () => {
    const onConfirm = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <ShareDeleteConfirmation
        targetName="Jane Doe"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />
    );

    await user.click(screen.getByTestId('confirm-delete-share'));
    expect(onConfirm).toHaveBeenCalled();
  });
});
