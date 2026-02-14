import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WorkoutTable } from './WorkoutTable';

const mockEntries = [
  {
    id: 'workout_1',
    performedAt: '2024-01-15T10:00:00.000Z',
    exerciseId: 'back-squat',
    exerciseName: 'Back Squat',
    reps: 5,
    weight: 225,
    weightUnit: 'lb' as const,
    note: 'PR attempt'
  },
  {
    id: 'workout_2',
    performedAt: '2024-01-14T08:00:00.000Z',
    exerciseId: 'bench-press',
    exerciseName: 'Bench Press',
    reps: 8,
    weight: 185,
    weightUnit: 'lb' as const
  },
  {
    id: 'workout_3',
    performedAt: '2024-01-13T09:30:00.000Z',
    exerciseId: 'pull-up',
    exerciseName: 'Pull-Up',
    reps: 10,
    weight: 0,
    weightUnit: 'lb' as const,
    note: 'Bodyweight'
  }
];

describe('WorkoutTable', () => {
  it('renders empty state when no entries', () => {
    render(<WorkoutTable entries={[]} />);

    expect(screen.getByText('No workout entries yet')).toBeInTheDocument();
    expect(
      screen.getByText('Add your first workout above.')
    ).toBeInTheDocument();
  });

  it('renders table with entries', () => {
    render(<WorkoutTable entries={mockEntries} />);

    expect(screen.getByTestId('workout-table')).toBeInTheDocument();
    expect(screen.getByText('Back Squat')).toBeInTheDocument();
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Pull-Up')).toBeInTheDocument();
  });

  it('displays weight correctly', () => {
    render(<WorkoutTable entries={mockEntries} />);

    expect(screen.getByText('225.0 lb')).toBeInTheDocument();
    expect(screen.getByText('185.0 lb')).toBeInTheDocument();
    expect(screen.getByText('BW')).toBeInTheDocument();
  });

  it('displays notes correctly', () => {
    render(<WorkoutTable entries={mockEntries} />);

    expect(screen.getByText('PR attempt')).toBeInTheDocument();
    expect(screen.getByText('Bodyweight')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBe(1);
  });

  it('sorts by date descending by default', () => {
    render(<WorkoutTable entries={mockEntries} />);

    const rows = screen.getAllByRole('row').slice(1);

    expect(rows[0]).toHaveTextContent('Back Squat');
    expect(rows[1]).toHaveTextContent('Bench Press');
    expect(rows[2]).toHaveTextContent('Pull-Up');
  });

  it('toggles date sort direction on click', async () => {
    const user = userEvent.setup();
    render(<WorkoutTable entries={mockEntries} />);

    const dateButton = screen.getByRole('button', { name: /date/i });
    await user.click(dateButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Pull-Up');
    expect(rows[2]).toHaveTextContent('Back Squat');
  });

  it('sorts by exercise name when column clicked', async () => {
    const user = userEvent.setup();
    render(<WorkoutTable entries={mockEntries} />);

    const exerciseButton = screen.getByRole('button', { name: /exercise/i });
    await user.click(exerciseButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('Back Squat');
    expect(rows[1]).toHaveTextContent('Bench Press');
    expect(rows[2]).toHaveTextContent('Pull-Up');
  });

  it('sorts by reps when column clicked', async () => {
    const user = userEvent.setup();
    render(<WorkoutTable entries={mockEntries} />);

    const repsButton = screen.getByRole('button', { name: /reps/i });
    await user.click(repsButton);

    const rows = screen.getAllByRole('row').slice(1);
    const reps = rows.map((row) => {
      const cells = row.querySelectorAll('td');
      return cells[2]?.textContent;
    });

    expect(reps).toEqual(['5', '8', '10']);
  });

  it('sorts by weight when column clicked', async () => {
    const user = userEvent.setup();
    render(<WorkoutTable entries={mockEntries} />);

    const weightButton = screen.getByRole('button', { name: /weight/i });
    await user.click(weightButton);

    const rows = screen.getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('BW');
    expect(rows[2]).toHaveTextContent('225.0 lb');
  });

  it('has accessible table label', () => {
    render(<WorkoutTable entries={mockEntries} />);

    expect(
      screen.getByRole('table', { name: 'Workout entries table' })
    ).toBeInTheDocument();
  });
});
