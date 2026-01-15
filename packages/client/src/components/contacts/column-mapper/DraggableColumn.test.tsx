import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DraggableColumn } from './DraggableColumn';

const mockUseDraggable = vi.fn();

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => mockUseDraggable()
}));

describe('DraggableColumn', () => {
  it('renders with default drag styles', () => {
    mockUseDraggable.mockReturnValue({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      isDragging: false
    });

    render(<DraggableColumn index={0} header="Name" disabled={false} />);

    const column = screen.getByText('Name').parentElement;
    expect(column).toHaveClass('cursor-grab');
    expect(column).not.toHaveClass('opacity-50');
  });

  it('adds dragging styles when dragging', () => {
    mockUseDraggable.mockReturnValue({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      isDragging: true
    });

    render(<DraggableColumn index={1} header="Email" disabled={false} />);

    const column = screen.getByText('Email').parentElement;
    expect(column).toHaveClass('opacity-50');
  });

  it('adds disabled styles when disabled', () => {
    mockUseDraggable.mockReturnValue({
      attributes: {},
      listeners: {},
      setNodeRef: vi.fn(),
      isDragging: false
    });

    render(<DraggableColumn index={2} header="Phone" disabled />);

    const column = screen.getByText('Phone').parentElement;
    expect(column).toHaveClass('cursor-not-allowed');
    expect(column).toHaveClass('opacity-50');
  });
});
