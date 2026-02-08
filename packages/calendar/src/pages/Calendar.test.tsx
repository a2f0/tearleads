import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Calendar } from './Calendar';

describe('Calendar', () => {
  it('creates and selects a new calendar from the sidebar', () => {
    render(<Calendar />);

    const input = screen.getByLabelText('New calendar');
    fireEvent.change(input, { target: { value: 'Work' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create calendar' }));

    expect(screen.getByRole('button', { name: 'Work' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Month' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
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
});
