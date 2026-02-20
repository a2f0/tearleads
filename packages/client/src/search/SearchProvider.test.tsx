import { render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SearchProvider } from './SearchProvider';

const mockUseDatabaseContext = vi.fn();
const mockGetKeyManagerForInstance = vi.fn();
const mockUseOnInstanceChange = vi.fn();
const mockGetSearchStoreForInstance = vi.fn();
const mockCloseSearchStoreForInstance = vi.fn();

vi.mock('@/db/hooks/useDatabase', () => ({
  useDatabaseContext: () => mockUseDatabaseContext()
}));

vi.mock('@/db/crypto', () => ({
  getKeyManagerForInstance: (instanceId: string) =>
    mockGetKeyManagerForInstance(instanceId)
}));

vi.mock('@/hooks/app', () => ({
  useOnInstanceChange: (
    callback: (next: string | null, prev: string | null) => void
  ) => mockUseOnInstanceChange(callback)
}));

vi.mock('@tearleads/search', async () => {
  const actual =
    await vi.importActual<typeof import('@tearleads/search')>(
      '@tearleads/search'
    );

  return {
    ...actual,
    getSearchStoreForInstance: (instanceId: string) =>
      mockGetSearchStoreForInstance(instanceId),
    closeSearchStoreForInstance: (instanceId: string) =>
      mockCloseSearchStoreForInstance(instanceId)
  };
});

describe('SearchProvider', () => {
  const mockInitialize = vi.fn();
  const mockGetState = vi.fn();
  const mockUpsertBatch = vi.fn();
  const mockRebuildFromDatabase = vi.fn();
  const mockStore = {
    initialize: mockInitialize,
    getState: mockGetState,
    upsertBatch: mockUpsertBatch,
    rebuildFromDatabase: mockRebuildFromDatabase
  };

  let requestAnimationFrameSpy: ReturnType<typeof vi.spyOn>;
  let cancelAnimationFrameSpy: ReturnType<typeof vi.spyOn>;

  async function flushTicks(count = 1): Promise<void> {
    for (let i = 0; i < count; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  beforeEach(() => {
    vi.clearAllMocks();

    requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback): number => {
        return setTimeout(() => callback(0), 0) as unknown as number;
      });

    cancelAnimationFrameSpy = vi
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id: number) => {
        clearTimeout(id);
      });

    mockUseDatabaseContext.mockReturnValue({
      currentInstanceId: 'instance-1',
      isUnlocked: true
    });
    mockGetKeyManagerForInstance.mockReturnValue({
      getCurrentKey: () => 'test-key'
    });
    mockGetSearchStoreForInstance.mockReturnValue(mockStore);
    mockCloseSearchStoreForInstance.mockResolvedValue(undefined);
    mockInitialize.mockResolvedValue(undefined);
    mockGetState.mockReturnValue({
      isInitialized: true,
      isIndexing: false,
      documentCount: 10,
      lastPersistedAt: null,
      error: null
    });
    mockUpsertBatch.mockResolvedValue(undefined);
    mockRebuildFromDatabase.mockResolvedValue(undefined);
  });

  afterEach(() => {
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it('indexes app and help catalogs in one batch after UI paint', async () => {
    render(
      <SearchProvider>
        <div>child</div>
      </SearchProvider>
    );

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalledWith('test-key', 'instance-1');
    });

    expect(mockUpsertBatch).not.toHaveBeenCalled();

    await flushTicks(4);

    await waitFor(() => {
      expect(mockUpsertBatch).toHaveBeenCalledTimes(1);
    });

    const firstCallDocs = mockUpsertBatch.mock.calls[0]?.[0];
    expect(Array.isArray(firstCallDocs)).toBe(true);
    expect(firstCallDocs.length).toBeGreaterThan(0);
    expect(
      firstCallDocs.some(
        (doc: { entityType: string }) => doc.entityType === 'app'
      )
    ).toBe(true);
    expect(
      firstCallDocs.some(
        (doc: { entityType: string }) => doc.entityType === 'help_doc'
      )
    ).toBe(true);
  });

  it('cancels deferred app/help indexing on unmount', async () => {
    const { unmount } = render(
      <SearchProvider>
        <div>child</div>
      </SearchProvider>
    );

    await waitFor(() => {
      expect(mockInitialize).toHaveBeenCalled();
    });

    unmount();
    await flushTicks(4);

    expect(mockUpsertBatch).not.toHaveBeenCalled();
  });
});
