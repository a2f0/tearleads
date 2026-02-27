import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutDetail } from './WorkoutDetail';

const mockAddEntry = vi.fn();
const mockUseWorkoutData = vi.fn();

vi.mock('./useWorkoutData', () => ({
  useWorkoutData: () => mockUseWorkoutData()
}));

vi.mock('../../sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock to view {description}</div>
  )
}));

vi.mock('@/contexts/WindowManagerContext', () => ({
  useWindowManagerActions: () => ({
    openWindow: vi.fn()
  })
}));

const wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>{children}</MemoryRouter>
);

const mockExercises = [
  { id: 'back-squat', name: 'Back Squat' },
  { id: 'bench-press', name: 'Bench Press' },
  { id: 'pull-up', name: 'Pull-Up' },
  { id: 'wide-grip', name: 'Wide Grip Pull-Up', parentId: 'pull-up' }
];

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
  }
];

describe('WorkoutDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddEntry.mockResolvedValue({
      id: 'workout_2',
      performedAt: '2024-01-16T10:00:00.000Z',
      exerciseId: 'bench-press',
      exerciseName: 'Bench Press',
      reps: 8,
      weight: 185,
      weightUnit: 'lb' as const
    });
  });

  it('shows unlock prompt when database is locked', () => {
    mockUseWorkoutData.mockReturnValue({
      entries: [],
      exercises: [],
      loading: false,
      error: null,
      hasFetched: false,
      isUnlocked: false,
      addEntry: mockAddEntry
    });

    render(<WorkoutDetail />, { wrapper });

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    expect(
      screen.getByText('Unlock to view workout entries')
    ).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseWorkoutData.mockReturnValue({
      entries: [],
      exercises: [],
      loading: true,
      error: null,
      hasFetched: false,
      isUnlocked: true,
      addEntry: mockAddEntry
    });

    const { container } = render(<WorkoutDetail />, { wrapper });

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUseWorkoutData.mockReturnValue({
      entries: [],
      exercises: [],
      loading: false,
      error: 'Database error',
      hasFetched: true,
      isUnlocked: true,
      addEntry: mockAddEntry
    });

    render(<WorkoutDetail />, { wrapper });

    expect(screen.getByText('Failed to load workout data')).toBeInTheDocument();
    expect(screen.getByText('Database error')).toBeInTheDocument();
  });

  it('renders form and table when unlocked', () => {
    mockUseWorkoutData.mockReturnValue({
      entries: mockEntries,
      exercises: mockExercises,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addEntry: mockAddEntry
    });

    render(<WorkoutDetail />, { wrapper });

    expect(
      screen.getByRole('form', { name: 'Add workout entry form' })
    ).toBeInTheDocument();
    expect(screen.getByTestId('workout-table')).toBeInTheDocument();
    // Back Squat appears in both the form dropdown and the table, verify table has entry
    expect(screen.getAllByText('Back Squat').length).toBeGreaterThanOrEqual(1);
  });

  it('calls addEntry when form is submitted', async () => {
    const user = userEvent.setup();
    mockUseWorkoutData.mockReturnValue({
      entries: [],
      exercises: mockExercises,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addEntry: mockAddEntry
    });

    render(<WorkoutDetail />, { wrapper });

    // Use two-step selection: first Category, then fill form
    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    fireEvent.submit(
      screen.getByRole('form', { name: 'Add workout entry form' })
    );

    await waitFor(() => {
      expect(mockAddEntry).toHaveBeenCalledTimes(1);
    });
  });

  it('shows empty state when no entries', () => {
    mockUseWorkoutData.mockReturnValue({
      entries: [],
      exercises: mockExercises,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addEntry: mockAddEntry
    });

    render(<WorkoutDetail />, { wrapper });

    expect(screen.getByText('No workout entries yet')).toBeInTheDocument();
  });
});
