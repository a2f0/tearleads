import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SyncQueueInboundStatus } from './SyncQueueInboundStatus';

describe('SyncQueueInboundStatus', () => {
  it('renders cursor change ID when cursor is present', () => {
    render(
      <SyncQueueInboundStatus
        inbound={{
          cursor: {
            changedAt: '2024-01-15T10:00:00Z',
            changeId: 'abcdef1234567890'
          },
          pendingOperations: 3,
          nextLocalWriteId: 42,
          blobDownloads: []
        }}
      />
    );
    expect(screen.getByText('abcdef12')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders "None" when cursor is null', () => {
    render(
      <SyncQueueInboundStatus
        inbound={{
          cursor: null,
          pendingOperations: 0,
          nextLocalWriteId: 1,
          blobDownloads: []
        }}
      />
    );
    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('renders labels for each field', () => {
    render(
      <SyncQueueInboundStatus
        inbound={{
          cursor: null,
          pendingOperations: 0,
          nextLocalWriteId: 0,
          blobDownloads: []
        }}
      />
    );
    expect(screen.getByText(/Cursor/)).toBeInTheDocument();
    expect(screen.getByText(/Pending/)).toBeInTheDocument();
    expect(screen.getByText(/Next Write ID/)).toBeInTheDocument();
  });
});
