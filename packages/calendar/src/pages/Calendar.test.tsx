import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_CREATE_EVENT } from '../events';
import { Calendar } from './Calendar';

describe('Calendar', () => {
  it('creates and selects a new calendar from the file menu event', () => {
    const promptSpy = vi.spyOn(window, 'prompt').mockReturnValue('Work');
    try {
      render(<Calendar />);

      fireEvent(window, new Event(CALENDAR_CREATE_EVENT));

      expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute(
        'aria-selected',
        'true'
      );
    } finally {
      promptSpy.mockRestore();
    }
  });

  it('switches between day, week, month, and year views', () => {
    render(<Calendar />);

    fireEvent.click(screen.getByRole('tab', { name: 'Day' }));
    expect(screen.getByText('08:00')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Week' }));
    expect(screen.getByText(/Week of/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Month' }));
    expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute(
      'aria-selected',
      'true'
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Year' }));
    expect(screen.getByText('January')).toBeInTheDocument();
    expect(screen.getByText('December')).toBeInTheDocument();
  });

  it('routes to day view when a month day is double-clicked', () => {
    render(<Calendar />);

    const monthDayButtons = screen.getAllByRole('button', {
      name: /Open day view for/
    });
    const monthDayButton = monthDayButtons[0];
    if (!monthDayButton) {
      throw new Error('Expected at least one month day button');
    }

    fireEvent.doubleClick(monthDayButton);

    expect(screen.getByRole('tab', { name: 'Day' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByText('08:00')).toBeInTheDocument();
  });
});
