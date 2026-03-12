import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SyncQueueCrdtSection } from './SyncQueueCrdtSection';

const MOCK_OPS = [
  {
    opId: 'op-1',
    opType: 'create',
    itemId: 'item-abcdef1234567890',
    writeId: 1,
    occurredAt: '2024-01-15T10:00:00Z',
    encrypted: false
  },
  {
    opId: 'op-2',
    opType: 'update',
    itemId: 'item-9876543210fedcba',
    writeId: 2,
    occurredAt: '2024-01-15T10:01:00Z',
    encrypted: true
  }
];

describe('SyncQueueCrdtSection', () => {
  it('renders section header with count badge', () => {
    render(<SyncQueueCrdtSection operations={MOCK_OPS} />);
    expect(screen.getByText('CRDT Operations')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders operations when expanded', () => {
    render(<SyncQueueCrdtSection operations={MOCK_OPS} />);
    expect(screen.getByText('create')).toBeInTheDocument();
    expect(screen.getByText('update')).toBeInTheDocument();
  });

  it('shows "Encrypted" for encrypted operations', () => {
    render(<SyncQueueCrdtSection operations={MOCK_OPS} />);
    expect(screen.getByText('Encrypted')).toBeInTheDocument();
  });

  it('collapses when header is clicked', async () => {
    const user = userEvent.setup();
    render(<SyncQueueCrdtSection operations={MOCK_OPS} />);

    await user.click(screen.getByText('CRDT Operations'));
    expect(screen.queryByText('create')).not.toBeInTheDocument();
  });

  it('re-expands when header is clicked again', async () => {
    const user = userEvent.setup();
    render(<SyncQueueCrdtSection operations={MOCK_OPS} />);

    await user.click(screen.getByText('CRDT Operations'));
    await user.click(screen.getByText('CRDT Operations'));
    expect(screen.getByText('create')).toBeInTheDocument();
  });
});
