import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SyncQueueBlobSection } from './SyncQueueBlobSection';

const MOCK_OPS = [
  {
    operationId: 'blob-1',
    kind: 'stage',
    stagingId: 'staging-abcdef1234',
    itemId: undefined,
    chunkIndex: undefined
  },
  {
    operationId: 'blob-2',
    kind: 'attach',
    stagingId: undefined,
    itemId: 'item-9876543210',
    chunkIndex: undefined
  }
];

describe('SyncQueueBlobSection', () => {
  it('renders section header with count badge', () => {
    render(<SyncQueueBlobSection operations={MOCK_OPS} />);
    expect(screen.getByText('Blob Operations')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders operations when expanded', () => {
    render(<SyncQueueBlobSection operations={MOCK_OPS} />);
    expect(screen.getByText('stage')).toBeInTheDocument();
    expect(screen.getByText('attach')).toBeInTheDocument();
  });

  it('shows staging ID detail for stage ops', () => {
    render(<SyncQueueBlobSection operations={MOCK_OPS} />);
    expect(screen.getByText('staging:staging-')).toBeInTheDocument();
  });

  it('collapses when header is clicked', async () => {
    const user = userEvent.setup();
    render(<SyncQueueBlobSection operations={MOCK_OPS} />);

    await user.click(screen.getByText('Blob Operations'));
    expect(screen.queryByText('stage')).not.toBeInTheDocument();
  });
});
