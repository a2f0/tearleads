import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HeightForm } from './HeightForm';

describe('HeightForm', () => {
  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOnSubmit.mockResolvedValue(undefined);
  });

  it('renders all form fields', () => {
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    expect(screen.getByLabelText('Height')).toBeInTheDocument();
    expect(screen.getByLabelText('Unit')).toBeInTheDocument();
    expect(screen.getByLabelText('Date & Time')).toBeInTheDocument();
    expect(screen.getByLabelText('Note')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Add Reading' })
    ).toBeInTheDocument();
  });

  it('has accessible form label', () => {
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    expect(
      screen.getByRole('form', { name: 'Add height reading form' })
    ).toBeInTheDocument();
  });

  it('shows validation error when height is empty', async () => {
    const user = userEvent.setup();
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    expect(screen.getByText('Height is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error for invalid height', async () => {
    const user = userEvent.setup();
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    await user.type(screen.getByLabelText('Height'), '0');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    expect(
      screen.getByText('Height must be a positive number')
    ).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('shows validation error when date is cleared', async () => {
    const user = userEvent.setup();
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    const dateInput = screen.getByLabelText('Date & Time');
    await user.clear(dateInput);
    await user.type(screen.getByLabelText('Height'), '42');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    expect(screen.getByText('Date is required')).toBeInTheDocument();
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('submits form with valid data', async () => {
    const user = userEvent.setup();
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    await user.type(screen.getByLabelText('Height'), '42.5');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    const call = mockOnSubmit.mock.calls[0]?.[0];
    expect(call.value).toBe(42.5);
    expect(call.unit).toBe('in');
    expect(call.recordedAt).toBeInstanceOf(Date);
  });

  it('allows selecting cm unit', async () => {
    const user = userEvent.setup();
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    await user.type(screen.getByLabelText('Height'), '109.2');
    await user.selectOptions(screen.getByLabelText('Unit'), 'cm');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    expect(mockOnSubmit.mock.calls[0]?.[0].unit).toBe('cm');
  });

  it('includes note when provided', async () => {
    const user = userEvent.setup();
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    await user.type(screen.getByLabelText('Height'), '43');
    await user.type(screen.getByLabelText('Note'), 'Annual checkup');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
    });

    expect(mockOnSubmit.mock.calls[0]?.[0].note).toBe('Annual checkup');
  });

  it('clears form after successful submit', async () => {
    const user = userEvent.setup();
    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    const heightInput = screen.getByLabelText('Height');
    const noteInput = screen.getByLabelText('Note');

    await user.type(heightInput, '44');
    await user.type(noteInput, 'Test note');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(heightInput).toHaveValue(null);
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

    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    await user.type(screen.getByLabelText('Height'), '42');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    expect(screen.getByText('Adding...')).toBeInTheDocument();
    expect(screen.getByLabelText('Height')).toBeDisabled();

    resolveSubmit();

    await waitFor(() => {
      expect(screen.getByLabelText('Height')).not.toBeDisabled();
    });
  });

  it('displays error when submission fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    mockOnSubmit.mockRejectedValue(new Error('Database error'));

    render(<HeightForm onSubmit={mockOnSubmit} availableContacts={[]} />);

    await user.type(screen.getByLabelText('Height'), '42');
    await user.click(screen.getByRole('button', { name: 'Add Reading' }));

    await waitFor(() => {
      expect(screen.getByText('Database error')).toBeInTheDocument();
    });
  });
});
