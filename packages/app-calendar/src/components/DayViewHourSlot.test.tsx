import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DayViewHourSlot } from './DayViewHourSlot';

describe('DayViewHourSlot', () => {
  const defaultProps = {
    hour: 9,
    isWorkHour: true,
    quarterSelections: [false, false, false, false] as [
      boolean,
      boolean,
      boolean,
      boolean
    ],
    isSelecting: false,
    onMouseDown: vi.fn(),
    onMouseEnter: vi.fn(),
    onClick: vi.fn()
  };

  it('renders the hour label', () => {
    render(<DayViewHourSlot {...defaultProps} />);
    expect(screen.getByText('09:00')).toBeInTheDocument();
  });

  it('renders four quarter slots', () => {
    render(<DayViewHourSlot {...defaultProps} />);

    expect(screen.getByTestId('hour-slot-9-q0')).toBeInTheDocument();
    expect(screen.getByTestId('hour-slot-9-q1')).toBeInTheDocument();
    expect(screen.getByTestId('hour-slot-9-q2')).toBeInTheDocument();
    expect(screen.getByTestId('hour-slot-9-q3')).toBeInTheDocument();
  });

  it('applies work hour styling when isWorkHour is true', () => {
    render(<DayViewHourSlot {...defaultProps} isWorkHour={true} />);

    const quarterSlot = screen.getByTestId('hour-slot-9-q0');
    expect(quarterSlot).toHaveClass('bg-accent/35');
  });

  it('applies non-work hour styling when isWorkHour is false', () => {
    render(<DayViewHourSlot {...defaultProps} isWorkHour={false} />);

    const quarterSlot = screen.getByTestId('hour-slot-9-q0');
    expect(quarterSlot).toHaveClass('bg-muted/40');
  });

  it('applies selection styling to selected quarters', () => {
    render(
      <DayViewHourSlot
        {...defaultProps}
        quarterSelections={[true, true, false, false]}
      />
    );

    expect(screen.getByTestId('hour-slot-9-q0')).toHaveClass('bg-primary/25');
    expect(screen.getByTestId('hour-slot-9-q1')).toHaveClass('bg-primary/25');
    expect(screen.getByTestId('hour-slot-9-q2')).not.toHaveClass(
      'bg-primary/25'
    );
    expect(screen.getByTestId('hour-slot-9-q3')).not.toHaveClass(
      'bg-primary/25'
    );
  });

  it('applies active selection styling when isSelecting is true', () => {
    render(
      <DayViewHourSlot
        {...defaultProps}
        quarterSelections={[true, false, false, false]}
        isSelecting={true}
      />
    );

    expect(screen.getByTestId('hour-slot-9-q0')).toHaveClass('bg-primary/35');
  });

  it('calls onMouseDown with correct slot on quarter mousedown', () => {
    const onMouseDown = vi.fn();
    render(<DayViewHourSlot {...defaultProps} onMouseDown={onMouseDown} />);

    fireEvent.mouseDown(screen.getByTestId('hour-slot-9-q2'));

    expect(onMouseDown).toHaveBeenCalledWith(
      { hour: 9, quarter: 2 },
      expect.any(Object)
    );
  });

  it('calls onMouseEnter with correct slot on quarter mouseenter', () => {
    const onMouseEnter = vi.fn();
    render(<DayViewHourSlot {...defaultProps} onMouseEnter={onMouseEnter} />);

    fireEvent.mouseEnter(screen.getByTestId('hour-slot-9-q1'));

    expect(onMouseEnter).toHaveBeenCalledWith({ hour: 9, quarter: 1 });
  });

  it('calls onClick with correct slot on quarter click', () => {
    const onClick = vi.fn();
    render(<DayViewHourSlot {...defaultProps} onClick={onClick} />);

    fireEvent.click(screen.getByTestId('hour-slot-9-q3'));

    expect(onClick).toHaveBeenCalledWith(
      { hour: 9, quarter: 3 },
      expect.any(Object)
    );
  });

  it('renders accessible labels for each quarter', () => {
    render(<DayViewHourSlot {...defaultProps} />);

    expect(screen.getByLabelText('09:00')).toBeInTheDocument();
    expect(screen.getByLabelText('09:15')).toBeInTheDocument();
    expect(screen.getByLabelText('09:30')).toBeInTheDocument();
    expect(screen.getByLabelText('09:45')).toBeInTheDocument();
  });

  it('formats single digit hours with leading zero', () => {
    render(<DayViewHourSlot {...defaultProps} hour={5} />);
    expect(screen.getByText('05:00')).toBeInTheDocument();
  });

  it('formats double digit hours correctly', () => {
    render(<DayViewHourSlot {...defaultProps} hour={14} />);
    expect(screen.getByText('14:00')).toBeInTheDocument();
  });
});
