import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SyncQueueInboundBlobSection } from './SyncQueueInboundBlobSection';

const MOCK_OPS = [
  {
    operationId: 'op-1',
    blobId: 'abcdef1234567890',
    itemId: 'item-1',
    sizeBytes: 1024
  },
  {
    operationId: 'op-2',
    blobId: '1234567890abcdef',
    itemId: 'item-2',
    sizeBytes: 2048
  }
];

describe('SyncQueueInboundBlobSection', () => {
  it('renders section header with count badge', () => {
    render(<SyncQueueInboundBlobSection operations={MOCK_OPS} />);
    expect(screen.getByText('Inbound Blob Downloads')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders operations when expanded', () => {
    render(<SyncQueueInboundBlobSection operations={MOCK_OPS} />);
    expect(screen.getByText('blob:abcdef12')).toBeInTheDocument();
    expect(screen.getByText('blob:12345678')).toBeInTheDocument();
  });

  it('shows download kind for each operation', () => {
    render(<SyncQueueInboundBlobSection operations={MOCK_OPS} />);
    const downloadBadges = screen.getAllByText('download');
    expect(downloadBadges).toHaveLength(2);
  });

  it('collapses when header is clicked', async () => {
    const user = userEvent.setup();
    render(<SyncQueueInboundBlobSection operations={MOCK_OPS} />);

    await user.click(screen.getByText('Inbound Blob Downloads'));
    expect(screen.queryByText('blob:abcdef12')).not.toBeInTheDocument();
  });

  it('renders empty list when no operations', () => {
    render(<SyncQueueInboundBlobSection operations={[]} />);
    expect(screen.getByText('Inbound Blob Downloads')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
