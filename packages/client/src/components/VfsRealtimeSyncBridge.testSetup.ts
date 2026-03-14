import { vi } from 'vitest';

export const mockUseSSE = vi.fn();
export const mockUseVfsOrchestratorInstance = vi.fn();
export const mockHydrateLocalReadModelFromRemoteFeeds = vi.fn();
export const mockLogInfo = vi.fn();
export const mockLogWarn = vi.fn();
export const mockGetActiveOrganizationId = vi.fn();
export const mockGetInstanceChangeSnapshot = vi.fn();
export const mockBlobDownloadSyncHydrateFromPersistence = vi.fn();
export const mockBlobDownloadSyncReset = vi.fn();
export const mockBlobDownloadSyncRun = vi.fn();
export const mockCreateVfsBlobDownloadSync = vi.fn((_input: unknown) => ({
  hydrateFromPersistence: (...args: unknown[]) =>
    mockBlobDownloadSyncHydrateFromPersistence(...args),
  reset: (...args: unknown[]) => mockBlobDownloadSyncReset(...args),
  sync: (...args: unknown[]) => mockBlobDownloadSyncRun(...args)
}));
export const orgChangeListeners = new Set<() => void>();

vi.mock('@/sse', () => ({
  useSSE: () => mockUseSSE()
}));

vi.mock('@/contexts/VfsOrchestratorContext', () => ({
  useVfsOrchestratorInstance: () => mockUseVfsOrchestratorInstance()
}));

vi.mock('@/lib/vfsReadModelHydration', () => ({
  hydrateLocalReadModelFromRemoteFeeds: (...args: unknown[]) =>
    mockHydrateLocalReadModelFromRemoteFeeds(...args)
}));

vi.mock('@/stores/logStore', () => ({
  logStore: {
    info: (...args: unknown[]) => mockLogInfo(...args),
    warn: (...args: unknown[]) => mockLogWarn(...args)
  }
}));

vi.mock('@/lib/orgStorage', () => ({
  hasActiveOrganizationId: () => {
    const organizationId = mockGetActiveOrganizationId();
    return (
      typeof organizationId === 'string' && organizationId.trim().length > 0
    );
  },
  onOrgChange: (listener: () => void) => {
    orgChangeListeners.add(listener);
    return () => {
      orgChangeListeners.delete(listener);
    };
  }
}));

vi.mock('@/hooks/app/useInstanceChange', () => ({
  getInstanceChangeSnapshot: () => mockGetInstanceChangeSnapshot()
}));

vi.mock('@/lib/authStorage', () => ({
  readStoredAuth: () => ({
    user: { id: 'user-1' }
  })
}));

vi.mock('@/lib/vfsBlobDownloadSync', () => ({
  createVfsBlobDownloadSync: (input: unknown) =>
    mockCreateVfsBlobDownloadSync(input)
}));

export function resetVfsRealtimeSyncBridgeTestMocks(): void {
  vi.clearAllMocks();
  orgChangeListeners.clear();
  mockGetActiveOrganizationId.mockReturnValue(null);
  mockGetInstanceChangeSnapshot.mockReturnValue({
    currentInstanceId: 'instance-1',
    instanceEpoch: 1
  });
  mockHydrateLocalReadModelFromRemoteFeeds.mockResolvedValue(undefined);
  mockBlobDownloadSyncHydrateFromPersistence.mockResolvedValue(false);
  mockBlobDownloadSyncRun.mockResolvedValue(undefined);
}
