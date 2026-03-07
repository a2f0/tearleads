import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadVfsOrchestratorState,
  saveVfsOrchestratorState
} from './vfsOrchestratorState';

const mockIsDatabaseInitialized = vi.fn(() => true);
const mockSelectLimit = vi.fn();
const mockSelectWhere = vi.fn(() => ({ limit: mockSelectLimit }));
const mockSelectFrom = vi.fn(() => ({ where: mockSelectWhere }));
const mockSelect = vi.fn(() => ({ from: mockSelectFrom }));

const mockInsertOnConflictDoUpdate = vi.fn();
const mockInsertValues = vi.fn(() => ({
  onConflictDoUpdate: mockInsertOnConflictDoUpdate
}));
const mockInsert = vi.fn(() => ({ values: mockInsertValues }));

const mockDb = {
  select: mockSelect,
  insert: mockInsert
};
const mockGetDatabase = vi.fn(() => mockDb);

vi.mock('@/db', () => ({
  isDatabaseInitialized: () => mockIsDatabaseInitialized(),
  getDatabase: () => mockGetDatabase()
}));

describe('vfsOrchestratorState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsDatabaseInitialized.mockReturnValue(true);
    mockGetDatabase.mockReturnValue(mockDb);
    mockSelectLimit.mockResolvedValue([]);
    mockInsertOnConflictDoUpdate.mockResolvedValue(undefined);
  });

  it('returns null when database is not initialized', async () => {
    mockIsDatabaseInitialized.mockReturnValue(false);
    await expect(
      loadVfsOrchestratorState('user-1', 'client')
    ).resolves.toBeNull();
  });

  it('returns null when persisted value is missing', async () => {
    mockSelectLimit.mockResolvedValue([]);
    await expect(
      loadVfsOrchestratorState('user-1', 'client')
    ).resolves.toBeNull();
  });

  it('returns null when database closes during load', async () => {
    mockGetDatabase.mockImplementationOnce(() => {
      throw new Error('Database not initialized');
    });

    await expect(
      loadVfsOrchestratorState('user-1', 'client')
    ).resolves.toBeNull();
  });

  it('loads persisted state JSON', async () => {
    mockSelectLimit.mockResolvedValue([
      {
        value: JSON.stringify({
          crdt: { pendingOperations: [], replaySnapshot: null },
          blob: { pendingOperations: [] }
        })
      }
    ]);

    const state = await loadVfsOrchestratorState('user-1', 'client');
    expect(state).toEqual({
      crdt: { pendingOperations: [], replaySnapshot: null },
      blob: { pendingOperations: [] }
    });
  });

  it('persists orchestrator state with upsert', async () => {
    const state = {
      crdt: null,
      blob: null
    };

    await saveVfsOrchestratorState('user-1', 'client', state);

    expect(mockInsert).toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        key: 'vfs_orchestrator_state:user-1:client',
        value: JSON.stringify(state),
        updatedAt: expect.any(Date)
      })
    );
    expect(mockInsertOnConflictDoUpdate).toHaveBeenCalled();
  });

  it('skips save when database closes during persistence', async () => {
    mockGetDatabase.mockImplementationOnce(() => {
      throw new Error('Database not initialized');
    });

    await expect(
      saveVfsOrchestratorState('user-1', 'client', {
        crdt: null,
        blob: null
      })
    ).resolves.toBeUndefined();
  });
});
