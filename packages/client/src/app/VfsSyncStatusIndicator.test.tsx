import { act, render, screen } from '@testing-library/react';
import type { MouseEventHandler } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VfsSyncStatusIndicator } from './VfsSyncStatusIndicator';

let mockIsAuthenticated = true;
let mockOrchestrator: {
  crdt: { snapshot: () => { pendingOperations: number } };
  blob: { queuedOperations: () => unknown[] };
} | null = null;

let mockSyncActivity = {
  uploadInflightCount: 0,
  downloadInflightCount: 0,
  lastSyncError: null as Error | null
};
let syncActivityCallback: (() => void) | null = null;

vi.mock('@tearleads/ui', () => ({
  cn: (...classes: Array<string | undefined>) =>
    classes.filter((value): value is string => Boolean(value)).join(' ')
}));

vi.mock('@tearleads/window-manager', () => {  return {
    WindowConnectionIndicator: ({
      state,
      tooltip
    }: {
      state: string;
      tooltip: string;
      onContextMenu?: MouseEventHandler<HTMLButtonElement>;
    }) => (
      <div data-testid="sync-indicator" data-state={state}>
        {tooltip}
      </div>
    )
  };
});

vi.mock('../contexts/AuthContext', () => ({
  useOptionalAuth: () => ({ isAuthenticated: mockIsAuthenticated })
}));

vi.mock('../contexts/VfsOrchestratorContext', () => ({
  useVfsOrchestratorInstance: () => mockOrchestrator
}));

vi.mock('../lib/vfsItemSyncWriter', () => ({
  getSyncActivity: () => mockSyncActivity,
  subscribeSyncActivity: (cb: () => void) => {
    syncActivityCallback = cb;
    return () => {
      syncActivityCallback = null;
    };
  }
}));

function createMockOrchestrator(crdtPending: number, blobPending: number) {
  return {
    crdt: { snapshot: () => ({ pendingOperations: crdtPending }) },
    blob: { queuedOperations: () => new Array(blobPending) }
  };
}

describe('VfsSyncStatusIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockIsAuthenticated = true;
    mockOrchestrator = createMockOrchestrator(0, 0);
    mockSyncActivity = {
      uploadInflightCount: 0,
      downloadInflightCount: 0,
      lastSyncError: null
    };
    syncActivityCallback = null;
  });

  it('returns null when not authenticated', () => {
    mockIsAuthenticated = false;

    const { container } = render(<VfsSyncStatusIndicator />);

    expect(container.innerHTML).toBe('');
  });

  it('returns null when orchestrator is unavailable', () => {
    mockOrchestrator = null;

    const { container } = render(<VfsSyncStatusIndicator />);

    expect(container.innerHTML).toBe('');
  });

  it('shows connected state when all data is synced', () => {
    mockOrchestrator = createMockOrchestrator(0, 0);

    render(<VfsSyncStatusIndicator />);

    const indicator = screen.getByTestId('sync-indicator');
    expect(indicator).toHaveAttribute('data-state', 'connected');
    expect(indicator).toHaveTextContent('All data synced');
  });

  it('shows disconnected state when crdt operations are pending', () => {
    mockOrchestrator = createMockOrchestrator(3, 0);

    render(<VfsSyncStatusIndicator />);

    const indicator = screen.getByTestId('sync-indicator');
    expect(indicator).toHaveAttribute('data-state', 'disconnected');
    expect(indicator).toHaveTextContent('3 operations pending sync');
  });

  it('shows disconnected state when blob operations are pending', () => {
    mockOrchestrator = createMockOrchestrator(0, 2);

    render(<VfsSyncStatusIndicator />);

    const indicator = screen.getByTestId('sync-indicator');
    expect(indicator).toHaveAttribute('data-state', 'disconnected');
    expect(indicator).toHaveTextContent('2 operations pending sync');
  });

  it('updates on poll interval', () => {
    mockOrchestrator = createMockOrchestrator(0, 0);

    render(<VfsSyncStatusIndicator />);

    expect(screen.getByTestId('sync-indicator')).toHaveAttribute(
      'data-state',
      'connected'
    );

    mockOrchestrator.crdt.snapshot = () => ({ pendingOperations: 5 });

    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId('sync-indicator')).toHaveAttribute(
      'data-state',
      'disconnected'
    );
  });

  it('shows uploading tooltip when only upload is active', () => {
    mockSyncActivity = {
      uploadInflightCount: 1,
      downloadInflightCount: 0,
      lastSyncError: null
    };

    render(<VfsSyncStatusIndicator />);

    const indicator = screen.getByTestId('sync-indicator');
    expect(indicator).toHaveAttribute('data-state', 'connecting');
    expect(indicator).toHaveTextContent('Uploading data...');
  });

  it('shows downloading tooltip when only download is active', () => {
    mockSyncActivity = {
      uploadInflightCount: 0,
      downloadInflightCount: 1,
      lastSyncError: null
    };

    render(<VfsSyncStatusIndicator />);

    const indicator = screen.getByTestId('sync-indicator');
    expect(indicator).toHaveAttribute('data-state', 'connecting');
    expect(indicator).toHaveTextContent('Downloading data...');
  });

  it('shows syncing tooltip when both upload and download are active', () => {
    mockSyncActivity = {
      uploadInflightCount: 1,
      downloadInflightCount: 1,
      lastSyncError: null
    };

    render(<VfsSyncStatusIndicator />);

    const indicator = screen.getByTestId('sync-indicator');
    expect(indicator).toHaveAttribute('data-state', 'connecting');
    expect(indicator).toHaveTextContent('Syncing data...');
  });

  it('shows disconnected state on sync error', () => {
    mockSyncActivity = {
      uploadInflightCount: 0,
      downloadInflightCount: 0,
      lastSyncError: new Error('Network failure')
    };

    render(<VfsSyncStatusIndicator />);

    const indicator = screen.getByTestId('sync-indicator');
    expect(indicator).toHaveAttribute('data-state', 'disconnected');
    expect(indicator).toHaveTextContent('Sync failed');
  });

  it('reacts to sync activity changes via subscriber', () => {
    render(<VfsSyncStatusIndicator />);

    expect(screen.getByTestId('sync-indicator')).toHaveAttribute(
      'data-state',
      'connected'
    );

    mockSyncActivity = {
      uploadInflightCount: 1,
      downloadInflightCount: 0,
      lastSyncError: null
    };
    act(() => {
      syncActivityCallback?.();
    });

    expect(screen.getByTestId('sync-indicator')).toHaveAttribute(
      'data-state',
      'connecting'
    );
  });
});
