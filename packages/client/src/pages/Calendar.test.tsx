import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Calendar } from './Calendar';

vi.mock('@tearleads/calendar', () => ({
  Calendar: () => <div>Calendar App</div>
}));

describe('Calendar', () => {
  it('renders the calendar app', () => {
    render(<Calendar />);

    expect(screen.getByText('Calendar App')).toBeInTheDocument();
  });
});
