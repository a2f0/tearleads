import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SyncWindowTabBar } from './SyncWindowTabBar';

describe('SyncWindowTabBar', () => {
  it('renders both tab buttons', () => {
    render(<SyncWindowTabBar activeTab="account" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Account' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Queue' })).toBeInTheDocument();
  });

  it('marks the active tab as selected', () => {
    render(<SyncWindowTabBar activeTab="queue" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Queue' })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: 'Account' })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('calls onTabChange when a tab is clicked', async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(<SyncWindowTabBar activeTab="account" onTabChange={onTabChange} />);

    await user.click(screen.getByRole('tab', { name: 'Queue' }));
    expect(onTabChange).toHaveBeenCalledWith('queue');
  });

  it('renders a tablist role container', () => {
    render(<SyncWindowTabBar activeTab="account" onTabChange={vi.fn()} />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });
});
