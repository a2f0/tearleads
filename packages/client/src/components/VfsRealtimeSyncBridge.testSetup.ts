import { vi } from 'vitest';

export const mockUseSSE = vi.fn();
export const mockUseVfsOrchestratorInstance = vi.fn();
export const mockHydrateLocalReadModelFromRemoteFeeds = vi.fn();
export const mockLogInfo = vi.fn();
export const mockLogWarn = vi.fn();
export const mockGetActiveOrganizationId = vi.fn();
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

export function resetVfsRealtimeSyncBridgeTestMocks(): void {
  vi.clearAllMocks();
  orgChangeListeners.clear();
  mockGetActiveOrganizationId.mockReturnValue(null);
  mockHydrateLocalReadModelFromRemoteFeeds.mockResolvedValue(undefined);
}
