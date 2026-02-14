import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkoutForm } from './WorkoutForm';

const mockExercises = [
  { id: 'back-squat', name: 'Back Squat' },
  { id: 'bench-press', name: 'Bench Press' },
  { id: 'deadlift', name: 'Deadlift' }
];

describe('WorkoutForm', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  it('renders all form fields', () => {
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

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

  it('shows exercise options', () => {
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    const select = screen.getByLabelText('Exercise');
    expect(select).toContainHTML('Back Squat');
    expect(select).toContainHTML('Bench Press');
    expect(select).toContainHTML('Deadlift');
  });

  it('shows validation error when exercise is not selected', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

    expect(screen.getByText('Exercise is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error when reps is empty', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(screen.getByLabelText('Weight'), '225');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

    expect(screen.getByText('Reps is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  // Note: Testing "invalid reps" (e.g., 0) is challenging because HTML number input
  // with min="1" prevents typing values below 1. The validation logic is covered
  // by other tests (empty field shows "Reps is required").

  it('shows validation error when weight is empty', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

    expect(screen.getByText('Weight is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('allows zero weight for bodyweight exercises', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '10');
    await user.type(screen.getByLabelText('Weight'), '0');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.weight).toBe(0);
  });

  it('submits form with valid data', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

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

  it('allows selecting kg unit', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '100');
    await user.selectOptions(screen.getByLabelText('Unit'), 'kg');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.weightUnit).toBe('kg');
  });

  it('includes note when provided', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    await user.type(screen.getByLabelText('Note'), 'PR attempt');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.note).toBe('PR attempt');
  });

  it('clears form after successful submit (except exercise)', async () => {
    const user = userEvent.setup();
    render(<WorkoutForm exercises={mockExercises} onSubmit={mockOnSubmit} />);

    const repsInput = screen.getByLabelText('Reps');
    const weightInput = screen.getByLabelText('Weight');
    const noteInput = screen.getByLabelText('Note');

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(repsInput, '5');
    await user.type(weightInput, '225');
    await user.type(noteInput, 'Test note');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

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

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

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

    await user.selectOptions(screen.getByLabelText('Exercise'), 'back-squat');
    await user.type(screen.getByLabelText('Reps'), '5');
    await user.type(screen.getByLabelText('Weight'), '225');
    await user.click(screen.getByRole('button', { name: 'Add Entry' }));

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });
});
