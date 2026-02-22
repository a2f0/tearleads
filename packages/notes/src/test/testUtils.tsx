import { vi } from 'vitest';
import type { DatabaseState } from '../context/NotesContext';

export const createMockDatabaseState = (): DatabaseState => ({
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
});

interface MockDb {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
}

export const createMockDatabase = (): MockDb => {
  const mockDb: MockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined)
    }))
  };
  return mockDb;
};

export const createMockVfsKeys = () => ({
  generateSessionKey: vi.fn(() => new Uint8Array(32)),
  wrapSessionKey: vi.fn(async () => 'wrapped-session-key')
});

export const createMockAuth = () => ({
  isLoggedIn: vi.fn(() => false),
  readStoredAuth: vi.fn((): { user: { id: string } | null } => ({
    user: { id: 'test-user-id' }
  }))
});

export const createMockFeatureFlags = () => ({
  getFeatureFlagValue: vi.fn(() => false)
});

export const createMockVfsApi = () => ({
  register: vi.fn(async () => {})
});

export interface MockContextOptions {
  databaseState?: Partial<DatabaseState>;
  database?: ReturnType<typeof createMockDatabase>;
  vfsKeys?: Partial<ReturnType<typeof createMockVfsKeys>>;
  auth?: Partial<ReturnType<typeof createMockAuth>>;
  featureFlags?: Partial<ReturnType<typeof createMockFeatureFlags>>;
  vfsApi?: Partial<ReturnType<typeof createMockVfsApi>>;
}
