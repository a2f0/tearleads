import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RecurrenceEditor } from './RecurrenceEditor';

describe('RecurrenceEditor', () => {
  const defaultProps = {
    value: null,
    onChange: vi.fn(),
    startDate: new Date(2024, 5, 15)
  };

  it('renders the recurrence editor', () => {
    render(<RecurrenceEditor {...defaultProps} />);
    expect(screen.getByTestId('recurrence-editor')).toBeInTheDocument();
  });

  it('renders frequency select', () => {
    render(<RecurrenceEditor {...defaultProps} />);
    expect(screen.getByTestId('frequency-select')).toBeInTheDocument();
  });

  it('renders interval input', () => {
    render(<RecurrenceEditor {...defaultProps} />);
    expect(screen.getByTestId('interval-input')).toBeInTheDocument();
  });

  it('shows weekday picker when weekly frequency is selected', () => {
    render(<RecurrenceEditor {...defaultProps} value="FREQ=WEEKLY" />);
    expect(screen.getByTestId('weekday-monday')).toBeInTheDocument();
  });

  it('shows month day picker when monthly frequency is selected', () => {
    render(<RecurrenceEditor {...defaultProps} value="FREQ=MONTHLY" />);
    expect(
      screen.getByRole('radio', { name: /on day/i })
    ).toBeInTheDocument();
  });

  it('calls onChange when frequency changes', () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor {...defaultProps} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('frequency-select'), {
      target: { value: '3' }
    });

    expect(onChange).toHaveBeenCalled();
  });

  it('calls onChange when interval changes', () => {
    const onChange = vi.fn();
    render(<RecurrenceEditor {...defaultProps} onChange={onChange} />);

    fireEvent.change(screen.getByTestId('interval-input'), {
      target: { value: '2' }
    });

    expect(onChange).toHaveBeenCalled();
  });

  it('parses existing RRULE string', () => {
    render(
      <RecurrenceEditor
        {...defaultProps}
        value="FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR"
      />
    );

    expect(screen.getByTestId('frequency-select')).toHaveValue('2');
    expect(screen.getByTestId('interval-input')).toHaveValue(2);
  });

  it('disables all inputs when disabled is true', () => {
    render(<RecurrenceEditor {...defaultProps} disabled={true} />);

    expect(screen.getByTestId('frequency-select')).toBeDisabled();
    expect(screen.getByTestId('interval-input')).toBeDisabled();
  });

  it('shows end condition picker', () => {
    render(<RecurrenceEditor {...defaultProps} />);
    expect(screen.getByText('Ends')).toBeInTheDocument();
    expect(
      screen.getByRole('radio', { name: /never/i })
    ).toBeInTheDocument();
  });
});
