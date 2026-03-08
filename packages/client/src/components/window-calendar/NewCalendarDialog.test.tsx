import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewCalendarDialog } from './NewCalendarDialog';

describe('NewCalendarDialog', () => {
  it('closes when cancel is clicked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();

    render(
      <NewCalendarDialog open onOpenChange={onOpenChange} onCreate={vi.fn()} />
    );

    await user.click(screen.getByTestId('new-calendar-cancel'));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('creates a calendar with a trimmed name', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    const onOpenChange = vi.fn();

    render(
      <NewCalendarDialog open onOpenChange={onOpenChange} onCreate={onCreate} />
    );

    await user.type(screen.getByTestId('new-calendar-name-input'), '  Work  ');
    await user.click(screen.getByTestId('new-calendar-create'));

    expect(onCreate).toHaveBeenCalledWith('Work');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
