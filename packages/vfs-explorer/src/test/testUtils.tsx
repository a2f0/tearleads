import type { VfsSharePolicyPreviewResponse } from '@tearleads/shared';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import {
  type DatabaseState,
  VfsExplorerProvider,
  type VfsExplorerProviderProps
} from '../context';

// Default mock implementations
export const createMockDatabaseState = (): DatabaseState => ({
  isUnlocked: true,
  isLoading: false,
  currentInstanceId: 'test-instance'
});

interface MockDb {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  innerJoin: ReturnType<typeof vi.fn>;
  leftJoin: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  orderBy: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  transaction: ReturnType<typeof vi.fn>;
}

export const createMockDatabase = (): MockDb => {
  const mockDb: MockDb = {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    innerJoin: vi.fn().mockReturnThis(),
    leftJoin: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    insert: vi.fn(() => ({
      values: vi.fn().mockResolvedValue(undefined)
    })),
    transaction: vi.fn(async (callback: (tx: unknown) => Promise<void>) => {
      await callback({
        insert: vi.fn(() => ({
          values: vi.fn().mockResolvedValue(undefined)
        }))
      });
    })
  };
  return mockDb;
};

const createMockVfsKeys = () => ({
  generateSessionKey: vi.fn(() => new Uint8Array(32)),
  wrapSessionKey: vi.fn(async () => 'wrapped-session-key')
});

const createMockAuth = () => ({
  isLoggedIn: vi.fn(() => false),
  readStoredAuth: vi.fn((): { user: { id: string } | null } => ({
    user: { id: 'test-user-id' }
  }))
});

const createMockFeatureFlags = () => ({
  getFeatureFlagValue: vi.fn(() => false)
});

const createMockVfsApi = () => ({
  register: vi.fn(async () => {})
});

const createMockVfsShareApi = () => ({
  getShares: vi.fn(async () => ({ shares: [], orgShares: [] })),
  createShare: vi.fn(async () => ({
    id: 'share-1',
    itemId: 'item-1',
    shareType: 'user' as const,
    targetId: 'target-1',
    targetName: 'Target',
    permissionLevel: 'view' as const,
    createdBy: 'user-1',
    createdByEmail: 'user-1@example.com',
    createdAt: new Date().toISOString(),
    expiresAt: null
  })),
  updateShare: vi.fn(async () => ({
    id: 'share-1',
    itemId: 'item-1',
    shareType: 'user' as const,
    targetId: 'target-1',
    targetName: 'Target',
    permissionLevel: 'view' as const,
    createdBy: 'user-1',
    createdByEmail: 'user-1@example.com',
    createdAt: new Date().toISOString(),
    expiresAt: null
  })),
  deleteShare: vi.fn(async () => ({ deleted: true })),
  createOrgShare: vi.fn(async () => ({
    id: 'org-share:org-a:org-share-1',
    sourceOrgId: 'org-a',
    sourceOrgName: 'Org A',
    targetOrgId: 'org-b',
    targetOrgName: 'Org B',
    itemId: 'item-1',
    permissionLevel: 'view' as const,
    createdBy: 'user-1',
    createdByEmail: 'user-1@example.com',
    createdAt: new Date().toISOString(),
    expiresAt: null
  })),
  deleteOrgShare: vi.fn(async () => ({ deleted: true })),
  searchTargets: vi.fn(async () => ({ results: [] })),
  getSharePolicyPreview: vi.fn(
    async (): Promise<VfsSharePolicyPreviewResponse> => ({
      nodes: [],
      summary: {
        totalMatchingNodes: 0,
        returnedNodes: 0,
        directCount: 0,
        derivedCount: 0,
        deniedCount: 0,
        includedCount: 0,
        excludedCount: 0
      },
      nextCursor: null
    })
  )
});

export const createMockUI = () => ({
  Button: ({ children, ...props }: { children: ReactNode }) => (
    <button {...props}>{children}</button>
  ),
  Input: (props: Record<string, unknown>) => <input {...props} />,
  DropdownMenu: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuItem: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  DropdownMenuSeparator: () => <hr />,
  WindowOptionsMenuItem: () => <div>Options</div>,
  AboutMenuItem: () => <div>About</div>,
  FloatingWindow: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
});

interface MockContextOptions {
  databaseState?: Partial<DatabaseState>;
  database?: ReturnType<typeof createMockDatabase>;
  vfsKeys?: Partial<ReturnType<typeof createMockVfsKeys>>;
  auth?: Partial<ReturnType<typeof createMockAuth>>;
  featureFlags?: Partial<ReturnType<typeof createMockFeatureFlags>>;
  vfsApi?: Partial<ReturnType<typeof createMockVfsApi>>;
  vfsShareApi?: Partial<ReturnType<typeof createMockVfsShareApi>>;
}

function createMockContextValue(options: MockContextOptions = {}) {
  const database = options.database ?? createMockDatabase();

  return {
    databaseState: {
      ...createMockDatabaseState(),
      ...options.databaseState
    },
    getDatabase: () =>
      database as unknown as ReturnType<
        VfsExplorerProviderProps['getDatabase']
      >,
    ui: createMockUI() as unknown as VfsExplorerProviderProps['ui'],
    vfsKeys: {
      ...createMockVfsKeys(),
      ...options.vfsKeys
    },
    auth: {
      ...createMockAuth(),
      ...options.auth
    },
    featureFlags: {
      ...createMockFeatureFlags(),
      ...options.featureFlags
    },
    vfsApi: {
      ...createMockVfsApi(),
      ...options.vfsApi
    },
    vfsShareApi: {
      ...createMockVfsShareApi(),
      ...options.vfsShareApi
    }
  };
}

export function createWrapper(options: MockContextOptions = {}) {
  const contextValue = createMockContextValue(options);

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <VfsExplorerProvider
        databaseState={contextValue.databaseState}
        getDatabase={contextValue.getDatabase}
        ui={contextValue.ui}
        vfsKeys={contextValue.vfsKeys}
        auth={contextValue.auth}
        featureFlags={contextValue.featureFlags}
        vfsApi={contextValue.vfsApi}
        vfsShareApi={contextValue.vfsShareApi}
      >
        {children}
      </VfsExplorerProvider>
    );
  };
}
