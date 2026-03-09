import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AdminOptionsGrid } from './AdminOptionsGrid';

describe('AdminOptionsGrid', () => {
  it('renders existing admin options and Compliance', () => {
    render(<AdminOptionsGrid onSelect={vi.fn()} />);

    expect(screen.getByText('Redis')).toBeInTheDocument();
    expect(screen.getByText('Postgres')).toBeInTheDocument();
    expect(screen.getByText('Organizations')).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
  });

  it('calls onSelect with "redis" when Redis is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AdminOptionsGrid onSelect={onSelect} />);

    await user.click(screen.getByText('Redis'));

    expect(onSelect).toHaveBeenCalledWith('redis');
  });

  it('calls onSelect with "postgres" when Postgres is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AdminOptionsGrid onSelect={onSelect} />);

    await user.click(screen.getByText('Postgres'));

    expect(onSelect).toHaveBeenCalledWith('postgres');
  });

  it('calls onSelect with "organizations" when Organizations is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AdminOptionsGrid onSelect={onSelect} />);

    await user.click(screen.getByText('Organizations'));

    expect(onSelect).toHaveBeenCalledWith('organizations');
  });

  it('calls onSelect with "compliance" when Compliance is clicked', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<AdminOptionsGrid onSelect={onSelect} />);

    await user.click(screen.getByText('Compliance'));

    expect(onSelect).toHaveBeenCalledWith('compliance');
  });

  it('applies custom gridClassName', () => {
    const { container } = render(
      <AdminOptionsGrid onSelect={vi.fn()} gridClassName="lg:grid-cols-5" />
    );

    const grid = container.querySelector('.lg\\:grid-cols-5');
    expect(grid).toBeInTheDocument();
  });
});
