import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEventItem } from '../types';
import { DayViewEventBlock } from './DayViewEventBlock';

function createEvent(
  overrides: Partial<CalendarEventItem> = {}
): CalendarEventItem {
  const startAt = new Date(2024, 5, 15, 10, 0, 0, 0);
  const endAt = new Date(2024, 5, 15, 11, 0, 0, 0);

  return {
    id: '1',
    calendarName: 'Personal',
    title: 'Test Event',
    startAt,
    endAt,
    ...overrides
  };
}

describe('DayViewEventBlock', () => {
  const defaultProps = {
    event: createEvent(),
    top: 320,
    height: 32,
    left: '0%',
    width: '100%'
  };

  it('renders the event title', () => {
    render(<DayViewEventBlock {...defaultProps} />);
    expect(screen.getByText('Test Event')).toBeInTheDocument();
  });

  it('applies correct positioning styles', () => {
    render(<DayViewEventBlock {...defaultProps} />);

    const block = screen.getByTestId('event-block');
    expect(block).toHaveStyle({
      top: '320px',
      height: '32px',
      left: '0%',
      width: '100%'
    });
  });

  it('shows time range when height is sufficient', () => {
    render(<DayViewEventBlock {...defaultProps} height={32} />);
    expect(screen.getByText('10:00 - 11:00')).toBeInTheDocument();
  });

  it('hides time range when height is too small', () => {
    render(<DayViewEventBlock {...defaultProps} height={20} />);
    expect(screen.queryByText('10:00 - 11:00')).not.toBeInTheDocument();
  });

  it('shows only start time when event has no end time', () => {
    const event = createEvent({ endAt: null });
    render(<DayViewEventBlock {...defaultProps} event={event} height={32} />);
    expect(screen.getByText('10:00')).toBeInTheDocument();
  });

  it('shows recurring indicator when isRecurring is true', () => {
    render(<DayViewEventBlock {...defaultProps} isRecurring={true} />);
    expect(screen.getByText(/↻/)).toBeInTheDocument();
  });

  it('does not show recurring indicator when isRecurring is false', () => {
    render(<DayViewEventBlock {...defaultProps} isRecurring={false} />);
    expect(screen.queryByText(/↻/)).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const onClick = vi.fn();
    render(<DayViewEventBlock {...defaultProps} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('event-block'));
    expect(onClick).toHaveBeenCalled();
  });

  it('has accessible label with event title', () => {
    render(<DayViewEventBlock {...defaultProps} />);
    expect(screen.getByLabelText('Event: Test Event')).toBeInTheDocument();
  });

  it('handles partial width for overlapping events', () => {
    render(<DayViewEventBlock {...defaultProps} left="50%" width="50%" />);

    const block = screen.getByTestId('event-block');
    expect(block).toHaveStyle({
      left: '50%',
      width: '50%'
    });
  });
});
