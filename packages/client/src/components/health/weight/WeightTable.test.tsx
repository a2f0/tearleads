import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WeightTable } from './WeightTable';

const mockReadings = [
  {
    id: 'weight_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    value: 185.5,
    unit: 'lb' as const,
    note: 'Morning weight'
  },
  {
    id: 'weight_2',
    recordedAt: '2024-01-14T08:00:00.000Z',
    value: 186.0,
    unit: 'lb' as const
  },
  {
    id: 'weight_3',
    recordedAt: '2024-01-13T09:30:00.000Z',
    value: 84.5,
    unit: 'kg' as const,
    note: 'After workout'
  }
];

describe('WeightTable', () => {
  it('renders empty state when no readings', () => {
    render(<WeightTable readings={[]} />);

    expect(screen.getByText('No weight readings yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add your first reading above.')
    ).toBeInTheDocument();
  });

  it('renders table with readings', () => {
    render(<WeightTable readings={mockReadings} />);

    expect(screen.getByTestId('weight-table')).toBeInTheDocument();
    expect(screen.getByText('185.5 lb')).toBeInTheDocument();
    expect(screen.getByText('186.0 lb')).toBeInTheDocument();
    expect(screen.getByText('84.5 kg')).toBeInTheDocument();
  });

  it('displays notes correctly', () => {
    render(<WeightTable readings={mockReadings} />);

    expect(screen.getByText('Morning weight')).toBeInTheDocument();
    expect(screen.getByText('After workout')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBe(1);
  });

  it('sorts by date descending by default', () => {
    render(<WeightTable readings={mockReadings} />);

    const rows = screen.getAllByRole('row').slice(1);

    expect(rows[0]).toHaveTextContent('185.5 lb');
    expect(rows[1]).toHaveTextContent('186.0 lb');
    expect(rows[2]).toHaveTextContent('84.5 kg');
  });

  it('toggles date sort direction on click', async () => {
    const user = userEvent.setup();
    render(<WeightTable readings={mockReadings} />);

    const dateButton = screen.getByRole('button', { name: /date/i });
    await user.click(dateButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('84.5 kg');
    expect(rows[2]).toHaveTextContent('185.5 lb');
  });

  it('sorts by weight when column clicked', async () => {
    const user = userEvent.setup();
    render(<WeightTable readings={mockReadings} />);

    const weightButton = screen.getByRole('button', { name: /weight/i });
    await user.click(weightButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('84.5 kg');
    expect(rows[2]).toHaveTextContent('186.0 lb');
  });

  it('sorts by unit when column clicked', async () => {
    const user = userEvent.setup();
    render(<WeightTable readings={mockReadings} />);

    const unitButton = screen.getByRole('button', { name: /^unit$/i });
    await user.click(unitButton);

    const rows = screen.getAllByRole('row').slice(1);
    const units = rows.map((row) => {
      const cells = row.querySelectorAll('td');
      return cells[2]?.textContent;
    });

    expect(units).toContain('kg');
    expect(units).toContain('lb');
  });

  it('sorts by note when column clicked', async () => {
    const user = userEvent.setup();
    render(<WeightTable readings={mockReadings} />);

    const noteButton = screen.getByRole('button', { name: /note/i });
    await user.click(noteButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('After workout');
    expect(rows[1]).toHaveTextContent('Morning weight');
  });

  it('has accessible table label', () => {
    render(<WeightTable readings={mockReadings} />);

    expect(
      screen.getByRole('table', { name: 'Weight readings table' })
    ).toBeInTheDocument();
  });
});
