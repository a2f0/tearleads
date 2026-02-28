import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runOrgBackfillIfNeeded } from './orgBackfill';

const mockGetFromStore = vi.fn();
const mockSetInStore = vi.fn();

vi.mock('./registryStore', () => ({
  getFromStore: (...args: unknown[]) => mockGetFromStore(...args),
  setInStore: (...args: unknown[]) => mockSetInStore(...args)
}));

const updatedRows: Array<{ table: string; orgId: string }> = [];

function createMockDb() {
  const mockWhere = vi.fn().mockResolvedValue(undefined);
  const mockSet = vi.fn((values: { organizationId: string }) => {
    const table = updatedRows.length === 0 ? 'contacts' : 'vfs_registry';
    updatedRows.push({ table, orgId: values.organizationId });
    return { where: mockWhere };
  });
  const mockUpdate = vi.fn(() => ({ set: mockSet }));

  return {
    db: { update: mockUpdate } as unknown as Parameters<
      typeof runOrgBackfillIfNeeded
    >[0],
    mockUpdate,
    mockSet,
    mockWhere
  };
}

describe('orgBackfill', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    updatedRows.length = 0;
    mockGetFromStore.mockResolvedValue(null);
    mockSetInStore.mockResolvedValue(undefined);
  });

  it('backfills NULL rows to personal org', async () => {
    const { db, mockUpdate } = createMockDb();

    await runOrgBackfillIfNeeded(db, 'user-1', 'personal-org-user-1');

    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(updatedRows).toEqual([
      { table: 'contacts', orgId: 'personal-org-user-1' },
      { table: 'vfs_registry', orgId: 'personal-org-user-1' }
    ]);
  });

  it('sets completion flag in IndexedDB after backfill', async () => {
    const { db } = createMockDb();

    await runOrgBackfillIfNeeded(db, 'user-1', 'personal-org-user-1');

    expect(mockSetInStore).toHaveBeenCalledWith('org_backfill_user-1', true);
  });

  it('skips backfill when flag already set (idempotent)', async () => {
    mockGetFromStore.mockResolvedValue(true);
    const { db, mockUpdate } = createMockDb();

    await runOrgBackfillIfNeeded(db, 'user-1', 'personal-org-user-1');

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockSetInStore).not.toHaveBeenCalled();
  });

  it('checks the correct IndexedDB key', async () => {
    const { db } = createMockDb();

    await runOrgBackfillIfNeeded(db, 'user-42', 'personal-org-user-42');

    expect(mockGetFromStore).toHaveBeenCalledWith('org_backfill_user-42');
  });
});
