import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SyncQueueOutboundBlobActivity } from './SyncQueueOutboundBlobActivity';

const MOCK_OPS = [
  {
    operationId: 'op-1',
    kind: 'stage',
    success: true,
    timestamp: '2026-03-15T12:00:05.000Z',
    retryCount: 0
  },
  {
    operationId: 'op-2',
    kind: 'commit',
    success: true,
    timestamp: '2026-03-15T12:00:10.000Z',
    retryCount: 0
  },
  {
    operationId: 'op-3',
    kind: 'attach',
    success: false,
    timestamp: '2026-03-15T12:00:15.000Z',
    retryCount: 2,
    failureClass: 'http_status'
  }
];

describe('SyncQueueOutboundBlobActivity', () => {
  it('renders section header with count badge', () => {
    render(<SyncQueueOutboundBlobActivity operations={MOCK_OPS} />);
    expect(screen.getByText('Recent Blob Uploads')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows success and failure details when expanded', () => {
    render(<SyncQueueOutboundBlobActivity operations={MOCK_OPS} />);
    expect(screen.getByText('\u2713 stage')).toBeInTheDocument();
    expect(screen.getByText('\u2713 commit')).toBeInTheDocument();
    expect(screen.getByText('\u2717 attach (2 retries)')).toBeInTheDocument();
  });

  it('shows timestamps', () => {
    render(<SyncQueueOutboundBlobActivity operations={MOCK_OPS} />);
    expect(screen.getByText('12:00:05')).toBeInTheDocument();
    expect(screen.getByText('12:00:15')).toBeInTheDocument();
  });

  it('collapses when header is clicked', async () => {
    const user = userEvent.setup();
    render(<SyncQueueOutboundBlobActivity operations={MOCK_OPS} />);

    await user.click(screen.getByText('Recent Blob Uploads'));
    expect(screen.queryByText('\u2713 stage')).not.toBeInTheDocument();
  });

  it('renders empty list when no operations', () => {
    render(<SyncQueueOutboundBlobActivity operations={[]} />);
    expect(screen.getByText('Recent Blob Uploads')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
