import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutForm } from './WorkoutForm';

// Parent exercises (no parentId)
const mockParentExercises = [
  { id: 'back-squat', name: 'Back Squat' },
  { id: 'pull-up', name: 'Pull-Up' }
];

// Child exercises (have parentId)
const mockChildExercises = [
  { id: 'wide-grip', name: 'Wide Grip Pull-Up', parentId: 'pull-up' },
  { id: 'chin-up', name: 'Chin-Up', parentId: 'pull-up' }
];

const mockExercises = [...mockParentExercises, ...mockChildExercises];

describe('WorkoutForm', () => {
  const mockOnSubmit = vi.fn();
  const submit = () =>
    fireEvent.submit(
      screen.getByRole('form', { name: 'Add workout entry form' })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  it('renders all form fields', () => {
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    expect(screen.getByLabelText('Category')).toBeInTheDocument();
    expect(screen.getByLabelText('Exercise')).toBeInTheDocument();
    expect(screen.getByLabelText('Reps')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight')).toBeInTheDocument();
    expect(screen.getByLabelText('Unit')).toBeInTheDocument();
    expect(screen.getByLabelText('Date & Time')).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add Entry' })
    ).toBeInTheDocument();
  });

  it('has accessible form label', () => {
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    expect(
      screen.getByRole('form', { name: 'Add workout entry form' })
    ).toBeInTheDocument();
  });

  it('shows category options in first dropdown', () => {
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    const categorySelect = screen.getByLabelText('Category');
    expect(categorySelect).toContainHTML('Back Squat');
    expect(categorySelect).toContainHTML('Pull-Up');
  });

  it('shows child exercises after selecting category', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Category'), 'pull-up');

    const exerciseSelect = screen.getByLabelText('Exercise');
    expect(exerciseSelect).toContainHTML('Wide Grip Pull-Up');
    expect(exerciseSelect).toContainHTML('Chin-Up');
  });

  it('shows validation error when no category is selected', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    submit();

    expect(screen.getByText('Exercise is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error when reps is empty', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    // Select category without children (auto-selects as exercise)
    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Weight'), '225');
    submit();

    expect(screen.getByText('Reps is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  // Note: Testing "invalid reps" (e.g., 0) is challenging because HTML number input
  // with min="1" prevents typing values below 1. The validation logic is covered
  // by other tests (empty field shows "Reps is required").

  it('shows validation error when weight is empty', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    submit();

    expect(screen.getByText('Weight is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('allows zero weight for bodyweight exercises', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '10');
    await user.type(screen.getByLabelText('Weight'), '0');
    submit();

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.weight).toBe(0);
  });

  it('submits form with category that has no children', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    // back-squat has no children, so selecting it as category uses it as exercise
    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    submit();

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.exerciseId).toBe('back-squat');
    expect(call.reps).toBe(5);
    expect(call.weight).toBe(225);
    expect(call.weightUnit).toBe('lb');
    expect(call.performedAt).toBeInstanceOf(Date);
  });

  it('submits form with child exercise selected', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    // First select category, then child exercise
    await user.selectOptions(screen.getByLabelText('Category'), 'pull-up');
    await user.selectOptions(screen.getByLabelText('Exercise'), 'wide-grip');
    await user.type(screen.getByLabelText('Reps'), '10');
    await user.type(screen.getByLabelText('Weight'), '0');
    submit();

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.exerciseId).toBe('wide-grip');
    expect(call.reps).toBe(10);
  });

  it('allows selecting kg unit', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '100');
    await user.selectOptions(screen.getByLabelText('Unit'), 'kg');
    submit();

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.weightUnit).toBe('kg');
  });

  it('includes note when provided', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    await user.type(screen.getByLabelText('Note'), 'PR attempt');
    submit();

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.note).toBe('PR attempt');
  });

  it('clears form after successful submit', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    const repsInput = screen.getByLabelText('Reps');
    const weightInput = screen.getByLabelText('Weight');
    const noteInput = screen.getByLabelText('Note');

    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(repsInput, '5');
    await user.type(weightInput, '225');
    await user.type(noteInput, 'Test note');
    submit();

    await waitFor(() => {
      expect(repsInput).toHaveValue(null);
    });
    expect(weightInput).toHaveValue(null);
    expect(noteInput).toHaveValue('');
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

    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    submit();

    expect(screen.getByText('Adding...')).toBeInTheDocument();
    expect(screen.getByLabelText('Reps')).toBeDisabled();

    resolveSubmit();

    await waitFor(() => {
      expect(screen.getByLabelText('Reps')).not.toBeDisabled();
    });
  });

  it('displays error when submission fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    mockOnSubmit.mockRejectedValue(new Error('Database error'));

    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    submit();

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });

  it('resets exercise selection when category changes', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    // Select pull-up category and an exercise
    await user.selectOptions(screen.getByLabelText('Category'), 'pull-up');
    await user.selectOptions(screen.getByLabelText('Exercise'), 'wide-grip');

    // Change category to back-squat (no children)
    await user.selectOptions(screen.getByLabelText('Category'), 'back-squat');

    // The exercise dropdown should show "No variations"
    const exerciseSelect = screen.getByLabelText('Exercise');
    expect(exerciseSelect).toContainHTML('No variations');
  });
});
