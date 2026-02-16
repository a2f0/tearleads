import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ExerciseForm } from './ExerciseForm';

const mockParentExercises = [
  { id: 'pull-up', name: 'Pull-Up' },
  { id: 'back-squat', name: 'Back Squat' }
];

describe('ExerciseForm', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  it('renders all form fields', () => {
    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    expect(screen.getByLabelText('Exercise Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Category (Optional)')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add Exercise' })
    ).toBeInTheDocument();
  });

  it('has accessible form label', () => {
    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    expect(
      screen.getByRole('form', { name: 'Add exercise form' })
    ).toBeInTheDocument();
  });

  it('shows parent exercise options in category dropdown', () => {
    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    const categorySelect = screen.getByLabelText('Category (Optional)');
    expect(categorySelect).toContainHTML('Pull-Up');
    expect(categorySelect).toContainHTML('Back Squat');
    expect(categorySelect).toContainHTML('None (Top-level exercise)');
  });

  it('shows validation error when name is empty', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    await user.click(screen.getByRole('button', { name: 'Add Exercise' }));

    expect(screen.getByText('Name is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits form with name only (top-level exercise)', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    await user.type(screen.getByLabelText('Exercise Name'), 'Deadlift');
    await user.click(screen.getByRole('button', { name: 'Add Exercise' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.name).toBe('Deadlift');
    expect(call.parentId).toBeUndefined();
  });

  it('submits form with name and parent (child exercise)', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    await user.type(
      screen.getByLabelText('Exercise Name'),
      'Wide Grip Pull-Up'
    );
    await user.selectOptions(
      screen.getByLabelText('Category (Optional)'),
      'pull-up'
    );
    await user.click(screen.getByRole('button', { name: 'Add Exercise' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.name).toBe('Wide Grip Pull-Up');
    expect(call.parentId).toBe('pull-up');
  });

  it('clears form after successful submit', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    const nameInput = screen.getByLabelText('Exercise Name');
    const categorySelect = screen.getByLabelText('Category (Optional)');

    await user.type(nameInput, 'New Exercise');
    await user.selectOptions(categorySelect, 'pull-up');
    await user.click(screen.getByRole('button', { name: 'Add Exercise' }));

    await waitFor(() => {
      expect(nameInput).toHaveValue('');
    });
    expect(categorySelect).toHaveValue('');
  });

  it('shows loading state while submitting', async () => {
    const user = userEvent.setup();
    let resolveSubmit: () => void = () => {};
    mockOnSubmit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSubmit = resolve;
        })
    );

    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    await user.type(screen.getByLabelText('Exercise Name'), 'New Exercise');
    await user.click(screen.getByRole('button', { name: 'Add Exercise' }));

    expect(screen.getByText('Adding...')).toBeInTheDocument();
    expect(screen.getByLabelText('Exercise Name')).toBeDisabled();

    resolveSubmit();

    await waitFor(() => {
      expect(screen.getByLabelText('Exercise Name')).not.toBeDisabled();
    });
  });

  it('displays error when submission fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    mockOnSubmit.mockRejectedValue(new Error('Database error'));

    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    await user.type(screen.getByLabelText('Exercise Name'), 'New Exercise');
    await user.click(screen.getByRole('button', { name: 'Add Exercise' }));

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('trims whitespace from exercise name', async () => {
    const user = userEvent.setup();
    render(
      <ExerciseForm
        parentExercises={mockParentExercises}
        onSubmit={mockOnSubmit}
      />
    );

    await user.type(screen.getByLabelText('Exercise Name'), '  Front Squat  ');
    await user.click(screen.getByRole('button', { name: 'Add Exercise' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.name).toBe('Front Squat');
  });
});
