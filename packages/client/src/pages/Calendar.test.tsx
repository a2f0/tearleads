import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Calendar } from './Calendar';

vi.mock('@tearleads/app-calendar', () => ({
  CalendarContent: () => <div>Calendar Content</div>
}));

describe('Calendar', () => {
  it('renders the calendar app', () => {
    render(<Calendar />);

    expect(screen.getByText('Calendar Content')).toBeInTheDocument();
  });
});
