import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TimeRangePicker } from './TimeRangePicker';

describe('TimeRangePicker', () => {
  const defaultProps = {
    startTime: '09:00',
    endTime: '10:00',
    onStartTimeChange: vi.fn(),
    onEndTimeChange: vi.fn()
  };

  it('renders start and end time inputs', () => {
    render(<TimeRangePicker {...defaultProps} />);

    expect(screen.getByTestId('time-range-start')).toHaveValue('09:00');
    expect(screen.getByTestId('time-range-end')).toHaveValue('10:00');
  });

  it('calls onStartTimeChange when start time changes', () => {
    const onStartTimeChange = vi.fn();
    render(
      <TimeRangePicker
        {...defaultProps}
        onStartTimeChange={onStartTimeChange}
      />
    );

    fireEvent.change(screen.getByTestId('time-range-start'), {
      target: { value: '10:30' }
    });

    expect(onStartTimeChange).toHaveBeenCalledWith('10:30');
  });

  it('calls onEndTimeChange when end time changes', () => {
    const onEndTimeChange = vi.fn();
    render(
      <TimeRangePicker {...defaultProps} onEndTimeChange={onEndTimeChange} />
    );

    fireEvent.change(screen.getByTestId('time-range-end'), {
      target: { value: '11:30' }
    });

    expect(onEndTimeChange).toHaveBeenCalledWith('11:30');
  });

  it('displays duration for 1 hour event', () => {
    render(
      <TimeRangePicker {...defaultProps} startTime="09:00" endTime="10:00" />
    );

    expect(screen.getByTestId('time-range-duration')).toHaveTextContent('1h');
  });

  it('displays duration for 30 minute event', () => {
    render(
      <TimeRangePicker {...defaultProps} startTime="09:00" endTime="09:30" />
    );

    expect(screen.getByTestId('time-range-duration')).toHaveTextContent('30m');
  });

  it('displays duration for 1 hour 30 minute event', () => {
    render(
      <TimeRangePicker {...defaultProps} startTime="09:00" endTime="10:30" />
    );

    expect(screen.getByTestId('time-range-duration')).toHaveTextContent(
      '1h 30m'
    );
  });

  it('handles overnight events (end time before start time)', () => {
    render(
      <TimeRangePicker {...defaultProps} startTime="22:00" endTime="02:00" />
    );

    expect(screen.getByTestId('time-range-duration')).toHaveTextContent('4h');
  });

  it('disables inputs when disabled is true', () => {
    render(<TimeRangePicker {...defaultProps} disabled={true} />);

    expect(screen.getByTestId('time-range-start')).toBeDisabled();
    expect(screen.getByTestId('time-range-end')).toBeDisabled();
  });

  it('has accessible labels', () => {
    render(<TimeRangePicker {...defaultProps} />);

    expect(screen.getByLabelText('Event start time')).toBeInTheDocument();
    expect(screen.getByLabelText('Event end time')).toBeInTheDocument();
  });

  it('uses stable width classes on time inputs', () => {
    render(<TimeRangePicker {...defaultProps} />);

    expect(screen.getByTestId('time-range-start')).toHaveClass('min-w-0');
    expect(screen.getByTestId('time-range-end')).toHaveClass('min-w-0');
  });
});
