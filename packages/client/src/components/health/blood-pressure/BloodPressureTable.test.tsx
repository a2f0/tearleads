import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BloodPressureTable } from './BloodPressureTable';

const mockReadings = [
  {
    id: 'bp_1',
    recordedAt: '2024-01-15T10:00:00.000Z',
    systolic: 120,
    diastolic: 80,
    pulse: 72,
    note: 'Morning reading'
  },
  {
    id: 'bp_2',
    recordedAt: '2024-01-14T08:00:00.000Z',
    systolic: 125,
    diastolic: 82
  },
  {
    id: 'bp_3',
    recordedAt: '2024-01-13T09:30:00.000Z',
    systolic: 118,
    diastolic: 78,
    pulse: 68,
    note: 'After workout'
  }
];

describe('BloodPressureTable', () => {
  it('renders empty state when no readings', () => {
    render(<BloodPressureTable readings={[]} />);

    expect(
      screen.getByText('No blood pressure readings yet')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Add your first reading above.')
    ).toBeInTheDocument();
  });

  it('renders table with readings', () => {
    render(<BloodPressureTable readings={mockReadings} />);

    expect(screen.getByTestId('blood-pressure-table')).toBeInTheDocument();
    expect(screen.getByText('120/80')).toBeInTheDocument();
    expect(screen.getByText('125/82')).toBeInTheDocument();
    expect(screen.getByText('118/78')).toBeInTheDocument();
  });

  it('displays pulse correctly', () => {
    render(<BloodPressureTable readings={mockReadings} />);

    expect(screen.getByText('72')).toBeInTheDocument();
    expect(screen.getByText('68')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(1);
  });

  it('displays notes correctly', () => {
    render(<BloodPressureTable readings={mockReadings} />);

    expect(screen.getByText('Morning reading')).toBeInTheDocument();
    expect(screen.getByText('After workout')).toBeInTheDocument();
  });

  it('sorts by date descending by default', () => {
    render(<BloodPressureTable readings={mockReadings} />);

    const rows = screen.getAllByRole('row').slice(1);

    expect(rows[0]).toHaveTextContent('120/80');
    expect(rows[1]).toHaveTextContent('125/82');
    expect(rows[2]).toHaveTextContent('118/78');
  });

  it('toggles date sort direction on click', async () => {
    const user = userEvent.setup();
    render(<BloodPressureTable readings={mockReadings} />);

    const dateButton = screen.getByRole('button', { name: /date/i });
    await user.click(dateButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('118/78');
    expect(rows[2]).toHaveTextContent('120/80');
  });

  it('sorts by BP (systolic) when column clicked', async () => {
    const user = userEvent.setup();
    render(<BloodPressureTable readings={mockReadings} />);

    const bpButton = screen.getByRole('button', { name: /bp/i });
    await user.click(bpButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('118/78');
    expect(rows[2]).toHaveTextContent('125/82');
  });

  it('sorts by pulse when column clicked', async () => {
    const user = userEvent.setup();
    render(<BloodPressureTable readings={mockReadings} />);

    const pulseButton = screen.getByRole('button', { name: /pulse/i });
    await user.click(pulseButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('68');
    expect(rows[1]).toHaveTextContent('72');
  });

  it('has accessible table label', () => {
    render(<BloodPressureTable readings={mockReadings} />);

    expect(
      screen.getByRole('table', { name: 'Blood pressure readings table' })
    ).toBeInTheDocument();
  });
});
