import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SortHeader } from './SortHeader';

describe('SortHeader', () => {
  it('renders the label', () => {
    render(
      <SortHeader
        column="name"
        label="Name"
        currentColumn="uploadDate"
        direction="asc"
        onClick={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: 'Name' })).toBeInTheDocument();
  });

  it('shows ascending chevron when active and direction is asc', () => {
    render(
      <SortHeader
        column="name"
        label="Name"
        currentColumn="name"
        direction="asc"
        onClick={vi.fn()}
      />
    );

    // ChevronUp has class h-3 w-3
    const button = screen.getByRole('button');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('shows descending chevron when active and direction is desc', () => {
    render(
      <SortHeader
        column="name"
        label="Name"
        currentColumn="name"
        direction="desc"
        onClick={vi.fn()}
      />
    );

    const button = screen.getByRole('button');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('does not show chevron when not active', () => {
    render(
      <SortHeader
        column="name"
        label="Name"
        currentColumn="size"
        direction="asc"
        onClick={vi.fn()}
      />
    );

    const button = screen.getByRole('button');
    expect(button.querySelector('svg')).not.toBeInTheDocument();
  });

  it('calls onClick with column when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(
      <SortHeader
        column="size"
        label="Size"
        currentColumn="name"
        direction="asc"
        onClick={onClick}
      />
    );

    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledWith('size');
  });
});
