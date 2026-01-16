import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AddNoteCard } from './AddNoteCard';

describe('AddNoteCard', () => {
  it('renders with large size by default', () => {
    render(<AddNoteCard onClick={vi.fn()} />);

    const button = screen.getByTestId('add-note-card');
    expect(button).toBeInTheDocument();
    expect(button).toHaveClass('p-8');
    expect(screen.getByText('Add new note')).toBeInTheDocument();
  });

  it('renders with small size when specified', () => {
    render(<AddNoteCard onClick={vi.fn()} size="small" />);

    const button = screen.getByTestId('add-note-card');
    expect(button).toHaveClass('p-4');
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(<AddNoteCard onClick={handleClick} />);

    await user.click(screen.getByTestId('add-note-card'));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('renders sticky note and plus icons', () => {
    render(<AddNoteCard onClick={vi.fn()} />);

    const button = screen.getByTestId('add-note-card');
    const svgs = button.querySelectorAll('svg');
    expect(svgs).toHaveLength(2);
  });
});
