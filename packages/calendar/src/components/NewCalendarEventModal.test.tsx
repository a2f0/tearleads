import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewCalendarEventModal } from './NewCalendarEventModal';

describe('NewCalendarEventModal', () => {
  const baseProps = {
    open: true,
    onOpenChange: vi.fn(),
    calendarName: 'Personal',
    selectedDate: new Date('2026-02-17T09:00:00Z')
  };

  it('only toggles repeat when checkbox is clicked', () => {
    render(<NewCalendarEventModal {...baseProps} />);

    expect(screen.queryByTestId('recurrence-editor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Repeat'));
    expect(screen.queryByTestId('recurrence-editor')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Repeat' }));
    expect(screen.getByTestId('recurrence-editor')).toBeInTheDocument();
  });
});
