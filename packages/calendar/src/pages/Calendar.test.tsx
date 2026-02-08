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
    expect(
      screen.getByText('Month and events view coming next.')
    ).toBeInTheDocument();
  });
});
