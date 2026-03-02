import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeferredLockPasswordDialog } from './DeferredLockPasswordDialog';

function renderDialog(
  props: Partial<ComponentProps<typeof DeferredLockPasswordDialog>> = {}
) {
  const onOpenChange = props.onOpenChange ?? vi.fn();
  const onSubmit = props.onSubmit ?? vi.fn().mockResolvedValue(undefined);

  render(
    <DeferredLockPasswordDialog
      open
      isSaving={false}
      errorMessage={null}
      onOpenChange={onOpenChange}
      onSubmit={onSubmit}
      {...props}
    />
  );

  return { onOpenChange, onSubmit };
}

describe('DeferredLockPasswordDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not render when closed', () => {
    render(
      <DeferredLockPasswordDialog
        open={false}
        isSaving={false}
        errorMessage={null}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
      />
    );

    expect(
      screen.queryByTestId('deferred-lock-password-dialog')
    ).not.toBeInTheDocument();
  });

  it('validates empty submit and does not call onSubmit', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.click(screen.getByTestId('deferred-lock-password-submit'));

    expect(
      screen.getByTestId('deferred-lock-password-error')
    ).toHaveTextContent('Enter a password to continue.');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed password', async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderDialog();

    await user.type(screen.getByTestId('deferred-lock-password-input'), ' pass ');
    await user.click(screen.getByTestId('deferred-lock-password-submit'));

    expect(onSubmit).toHaveBeenCalledWith('pass');
  });

  it('shows external error message', () => {
    renderDialog({ errorMessage: 'Could not save password' });

    expect(
      screen.getByTestId('deferred-lock-password-error')
    ).toHaveTextContent('Could not save password');
  });

  it('closes via escape, backdrop, and cancel when not saving', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();

    fireEvent.keyDown(screen.getByTestId('deferred-lock-password-dialog'), {
      key: 'Escape'
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    await user.click(screen.getByTestId('deferred-lock-password-backdrop'));
    await user.click(screen.getByTestId('deferred-lock-password-cancel'));
    expect(onOpenChange).toHaveBeenCalledTimes(3);
  });

  it('does not close while saving', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog({ isSaving: true });

    fireEvent.keyDown(screen.getByTestId('deferred-lock-password-dialog'), {
      key: 'Escape'
    });
    await user.click(screen.getByTestId('deferred-lock-password-backdrop'));
    expect(screen.getByTestId('deferred-lock-password-cancel')).toBeDisabled();
    expect(screen.getByTestId('deferred-lock-password-submit')).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
