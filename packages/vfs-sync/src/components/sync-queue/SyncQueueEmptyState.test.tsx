import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyncQueueEmptyState } from './SyncQueueEmptyState';

describe('SyncQueueEmptyState', () => {
  it('renders the empty state message', () => {
    render(<SyncQueueEmptyState />);
    expect(screen.getByText('No pending operations')).toBeInTheDocument();
    expect(screen.getByText('All data is synced')).toBeInTheDocument();
  });
});
