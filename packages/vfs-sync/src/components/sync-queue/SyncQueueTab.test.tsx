import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as queueDeps from '../../lib/queueDependencies';
import { SyncQueueTab } from './SyncQueueTab';

describe('SyncQueueTab', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders empty state when no operations are pending', () => {
    vi.spyOn(queueDeps, 'getSyncQueueDependencies').mockReturnValue({
      useSnapshot: () => ({
        outbound: { crdt: [], blob: [], blobActivity: [] },
        inbound: {
          cursor: null,
          pendingOperations: 0,
          nextLocalWriteId: 0,
          blobDownloads: []
        }
      })
    });

    render(<SyncQueueTab />);
    expect(screen.getByText('No pending operations')).toBeInTheDocument();
    expect(screen.getByText('Inbound Status')).toBeInTheDocument();
  });

  it('renders CRDT section when CRDT operations exist', () => {
    vi.spyOn(queueDeps, 'getSyncQueueDependencies').mockReturnValue({
      useSnapshot: () => ({
        outbound: {
          crdt: [
            {
              opId: 'op-1',
              opType: 'create',
              itemId: 'item-abc',
              writeId: 1,
              occurredAt: '2024-01-15T10:00:00Z',
              encrypted: false
            }
          ],
          blob: [],
          blobActivity: []
        },
        inbound: {
          cursor: null,
          pendingOperations: 0,
          nextLocalWriteId: 1,
          blobDownloads: []
        }
      })
    });

    render(<SyncQueueTab />);
    expect(screen.getByText('CRDT Operations')).toBeInTheDocument();
    expect(screen.queryByText('No pending operations')).not.toBeInTheDocument();
  });

  it('renders blob section when blob operations exist', () => {
    vi.spyOn(queueDeps, 'getSyncQueueDependencies').mockReturnValue({
      useSnapshot: () => ({
        outbound: {
          crdt: [],
          blob: [
            {
              operationId: 'blob-1',
              kind: 'stage',
              stagingId: 'staging-xyz'
            }
          ],
          blobActivity: []
        },
        inbound: {
          cursor: null,
          pendingOperations: 0,
          nextLocalWriteId: 0,
          blobDownloads: []
        }
      })
    });

    render(<SyncQueueTab />);
    expect(screen.getByText('Blob Operations')).toBeInTheDocument();
  });

  it('renders inbound status with cursor', () => {
    vi.spyOn(queueDeps, 'getSyncQueueDependencies').mockReturnValue({
      useSnapshot: () => ({
        outbound: { crdt: [], blob: [], blobActivity: [] },
        inbound: {
          cursor: {
            changedAt: '2024-01-15T10:00:00Z',
            changeId: 'abcdef1234567890'
          },
          pendingOperations: 5,
          nextLocalWriteId: 10,
          blobDownloads: []
        }
      })
    });

    render(<SyncQueueTab />);
    expect(screen.getByText('abcdef12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('renders fallback when dependencies are not configured', () => {
    vi.spyOn(queueDeps, 'getSyncQueueDependencies').mockReturnValue(null);

    render(<SyncQueueTab />);
    expect(screen.getByText('No pending operations')).toBeInTheDocument();
  });
});
