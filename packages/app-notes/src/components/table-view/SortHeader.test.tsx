import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SortHeader } from './SortHeader';

describe('SortHeader', () => {
  it('calls onClick with its column when clicked', () => {
    const onClick = vi.fn();

    render(
      <SortHeader
        column="title"
        label="Title"
        currentColumn="updatedAt"
        direction="desc"
        onClick={onClick}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Title' }));
    expect(onClick).toHaveBeenCalledWith('title');
  });

  it('shows direction icon only for the active column', () => {
    const { container, rerender } = render(
      <SortHeader
        column="updatedAt"
        label="Updated"
        currentColumn="updatedAt"
        direction="asc"
        onClick={vi.fn()}
      />
    );

    expect(container.querySelector('svg')).toBeTruthy();

    rerender(
      <SortHeader
        column="updatedAt"
        label="Updated"
        currentColumn="title"
        direction="asc"
        onClick={vi.fn()}
      />
    );

    expect(container.querySelector('svg')).toBeFalsy();
  });
});
