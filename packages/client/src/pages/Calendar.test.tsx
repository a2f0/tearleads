import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { Calendar } from './Calendar';

vi.mock('@tearleads/app-calendar', () => ({
  CalendarContent: () => <div>Calendar Content</div>
}));

describe('Calendar', () => {
  it('renders the calendar app', () => {
    render(
      <MemoryRouter>
        <Calendar />
      </MemoryRouter>
    );

    expect(screen.getByText('Calendar Content')).toBeInTheDocument();
  });
});
