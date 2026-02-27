import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WeightForm } from './WeightForm';

describe('WeightForm', () => {
  const mockOnSubmit = vi.fn();
  const submit = () =>
    fireEvent.submit(
      screen.getByRole('form', { name: 'Add weight reading form' })
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  it('renders all form fields', () => {
    render(<WeightForm onSubmit={mockOnSubmit} />);

    expect(screen.getByLabelText('Weight')).toBeInTheDocument();
    expect(screen.getByLabelText('Unit')).toBeInTheDocument();
    expect(screen.getByLabelText('Date & Time')).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add Reading' })
    ).toBeInTheDocument();
  });

  it('has accessible form label', () => {
    render(<WeightForm onSubmit={mockOnSubmit} />);

    expect(
      screen.getByRole('form', { name: 'Add weight reading form' })
    ).toBeInTheDocument();
  });

  it('shows validation error when weight is empty', async () => {
    render(<WeightForm onSubmit={mockOnSubmit} />);

    submit();

    expect(screen.getByText('Weight is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error for invalid weight', async () => {
    const user = userEvent.setup();
    render(<WeightForm onSubmit={mockOnSubmit} />);

    const weightInput = screen.getByLabelText('Weight');
    await user.type(weightInput, '0');
    submit();

    expect(
      screen.getByText('Weight must be a positive number')
    ).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error when date is cleared', async () => {
    const user = userEvent.setup();
    render(<WeightForm onSubmit={mockOnSubmit} />);

    const dateInput = screen.getByLabelText('Date & Time');
    await user.clear(dateInput);
    await user.type(screen.getByLabelText('Weight'), '185');
    submit();

    expect(screen.getByText('Date is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    const user = userEvent.setup();
    render(<WeightForm onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText('Weight'), '185.5');
    submit();

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.value).toBe(185.5);
    expect(call.unit).toBe('lb');
    expect(call.recordedAt).toBeInstanceOf(Date);
  });

  it('allows selecting kg unit', async () => {
    const user = userEvent.setup();
    render(<WeightForm onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText('Weight'), '84');
    await user.selectOptions(screen.getByLabelText('Unit'), 'kg');
    submit();

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.unit).toBe('kg');
  });

  it('includes note when provided', async () => {
    const user = userEvent.setup();
    render(<WeightForm onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText('Weight'), '185');
    await user.type(screen.getByLabelText('Note'), 'Morning weight');
    submit();

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.note).toBe('Morning weight');
  });

  it('clears form after successful submit', async () => {
    const user = userEvent.setup();
    render(<WeightForm onSubmit={mockOnSubmit} />);

    const weightInput = screen.getByLabelText('Weight');
    const noteInput = screen.getByLabelText('Note');

    await user.type(weightInput, '185');
    await user.type(noteInput, 'Test note');
    submit();

    await waitFor(() => {
      expect(weightInput).toHaveValue(null);
    });
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

    render(<WeightForm onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText('Weight'), '185');
    submit();

    expect(screen.getByText('Adding...')).toBeInTheDocument();
    expect(screen.getByLabelText('Weight')).toBeDisabled();

    resolveSubmit();

    await waitFor(() => {
      expect(screen.getByLabelText('Weight')).not.toBeDisabled();
    });
  });

  it('displays error when submission fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    mockOnSubmit.mockRejectedValue(new Error('Database error'));

    render(<WeightForm onSubmit={mockOnSubmit} />);

    await user.type(screen.getByLabelText('Weight'), '185');
    submit();

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });
});
