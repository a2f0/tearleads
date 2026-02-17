import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseDetail } from './ExerciseDetail';

const mockAddExercise = vi.fn();
const mockUseExerciseData = vi.fn();

vi.mock('./useExerciseData', () => ({
  useExerciseData: () => mockUseExerciseData()
}));

vi.mock('../../sqlite/InlineUnlock', () => ({
  InlineUnlock: ({ description }: { description: string }) => (
    <div data-testid="inline-unlock">Unlock to view {description}</div>
  )
}));

const mockParentExercises = [
  { id: 'pull-up', name: 'Pull-Up' },
  { id: 'back-squat', name: 'Back Squat' }
];

const mockHierarchy = new Map([
  [
    'pull-up',
    [
      { id: 'wide-grip', name: 'Wide Grip Pull-Up', parentId: 'pull-up' },
      { id: 'chin-up', name: 'Chin-Up', parentId: 'pull-up' }
    ]
  ]
]);

describe('ExerciseDetail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAddExercise.mockResolvedValue({
      id: 'new-exercise',
      name: 'New Exercise'
    });
  });

  it('shows unlock prompt when database is locked', () => {
    mockUseExerciseData.mockReturnValue({
      parentExercises: [],
      hierarchy: new Map(),
      loading: false,
      error: null,
      hasFetched: false,
      isUnlocked: false,
      addExercise: mockAddExercise
    });

    render(<ExerciseDetail />);

    expect(screen.getByTestId('inline-unlock')).toBeInTheDocument();
    expect(screen.getByText('Unlock to view exercises')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    mockUseExerciseData.mockReturnValue({
      parentExercises: [],
      hierarchy: new Map(),
      loading: true,
      error: null,
      hasFetched: false,
      isUnlocked: true,
      addExercise: mockAddExercise
    });

    const { container } = render(<ExerciseDetail />);

    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });

  it('shows error state', () => {
    mockUseExerciseData.mockReturnValue({
      parentExercises: [],
      hierarchy: new Map(),
      loading: false,
      error: 'Database error',
      hasFetched: true,
      isUnlocked: true,
      addExercise: mockAddExercise
    });

    render(<ExerciseDetail />);

    expect(
      screen.getByText('Failed to load exercise data')
    ).toBeInTheDocument();
    expect(screen.getByText('Database error')).toBeInTheDocument();
  });

  it('renders form and list when unlocked', () => {
    mockUseExerciseData.mockReturnValue({
      parentExercises: mockParentExercises,
      hierarchy: mockHierarchy,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addExercise: mockAddExercise
    });

    render(<ExerciseDetail />);

    expect(
      screen.getByRole('form', { name: 'Add exercise form' })
    ).toBeInTheDocument();
    // Exercises appear in both the dropdown and the list
    expect(screen.getAllByText('Pull-Up').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Back Squat').length).toBeGreaterThanOrEqual(1);
  });

  it('calls addExercise when form is submitted', async () => {
    const user = userEvent.setup();
    mockUseExerciseData.mockReturnValue({
      parentExercises: mockParentExercises,
      hierarchy: mockHierarchy,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addExercise: mockAddExercise
    });

    render(<ExerciseDetail />);

    await user.type(screen.getByLabelText('Exercise Name'), 'Deadlift');
    await user.click(screen.getByRole('button', { name: 'Add Exercise' }));

    await waitFor(() => {
      expect(mockAddExercise).toHaveBeenCalledTimes(1);
    });

    expect(mockAddExercise).toHaveBeenCalledWith({ name: 'Deadlift' });
  });

  it('shows empty state when no exercises', () => {
    mockUseExerciseData.mockReturnValue({
      parentExercises: [],
      hierarchy: new Map(),
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addExercise: mockAddExercise
    });

    render(<ExerciseDetail />);

    expect(screen.getByText('No exercises found')).toBeInTheDocument();
  });

  it('shows variation count in list', () => {
    mockUseExerciseData.mockReturnValue({
      parentExercises: mockParentExercises,
      hierarchy: mockHierarchy,
      loading: false,
      error: null,
      hasFetched: true,
      isUnlocked: true,
      addExercise: mockAddExercise
    });

    render(<ExerciseDetail />);

    expect(screen.getByText('2 variations')).toBeInTheDocument();
  });
});
