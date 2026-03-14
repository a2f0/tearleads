import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { HeightTable } from './HeightTable';

const mockReadings = [
  {
    id: 'height_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    value: 42.5,
    unit: 'in' as const,
    note: 'Annual checkup',
    contactId: null
  },
  {
    id: 'height_2',
    recordedAt: '2024-01-14T08:00:00.000Z',
    value: 43.0,
    unit: 'in' as const,
    contactId: null
  },
  {
    id: 'height_3',
    recordedAt: '2024-01-13T09:30:00.000Z',
    value: 108.0,
    unit: 'cm' as const,
    note: 'School physical',
    contactId: null
  }
];

describe('HeightTable', () => {
  it('renders empty state when no readings', () => {
    render(<HeightTable readings={[]} />);

    expect(screen.getByText('No height readings yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add your first reading above.')
    ).toBeInTheDocument();
  });

  it('renders table with readings', () => {
    render(<HeightTable readings={mockReadings} />);

    expect(screen.getByTestId('height-table')).toBeInTheDocument();
    expect(screen.getByText('42.5 in')).toBeInTheDocument();
    expect(screen.getByText('43.0 in')).toBeInTheDocument();
    expect(screen.getByText('108.0 cm')).toBeInTheDocument();
  });

  it('displays notes correctly', () => {
    render(<HeightTable readings={mockReadings} />);

    expect(screen.getByText('Annual checkup')).toBeInTheDocument();
    expect(screen.getByText('School physical')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(1);
  });

  it('sorts by date descending by default', () => {
    render(<HeightTable readings={mockReadings} />);

    const rows = screen.getAllByRole('row').slice(1);

    expect(rows[0]).toHaveTextContent('42.5 in');
    expect(rows[1]).toHaveTextContent('43.0 in');
    expect(rows[2]).toHaveTextContent('108.0 cm');
  });

  it('toggles date sort direction on click', async () => {
    const user = userEvent.setup();
    render(<HeightTable readings={mockReadings} />);

    await user.click(screen.getByRole('button', { name: /date/i }));

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('108.0 cm');
    expect(rows[2]).toHaveTextContent('42.5 in');
  });

  it('sorts by height when column clicked', async () => {
    const user = userEvent.setup();
    render(<HeightTable readings={mockReadings} />);

    await user.click(screen.getByRole('button', { name: /height/i }));

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('42.5 in');
    expect(rows[2]).toHaveTextContent('108.0 cm');
  });

  it('sorts by unit when column clicked', async () => {
    const user = userEvent.setup();
    render(<HeightTable readings={mockReadings} />);

    await user.click(screen.getByRole('button', { name: /^unit$/i }));

    const rows = screen.getAllByRole('row').slice(1);
    const units = rows.map((row) => row.querySelectorAll('td')[2]?.textContent);

    expect(units).toContain('cm');
    expect(units).toContain('in');
  });

  it('sorts by note when column clicked', async () => {
    const user = userEvent.setup();
    render(<HeightTable readings={mockReadings} />);

    await user.click(screen.getByRole('button', { name: /note/i }));

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Annual checkup');
    expect(rows[1]).toHaveTextContent('School physical');
  });

  it('has accessible table label', () => {
    render(<HeightTable readings={mockReadings} />);

    expect(
      screen.getByRole('table', { name: 'Height readings table' })
    ).toBeInTheDocument();
  });
});
