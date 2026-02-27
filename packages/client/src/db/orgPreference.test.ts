import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearActiveOrgForUser,
  getActiveOrgForUser,
  setActiveOrgForUser
} from './orgPreference';

type StoreValue = string | null | undefined;
type MockRequest = {
  result: unknown;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
};

const mockStore = new Map<string, StoreValue>();
const mockIDBRequest = (result: unknown): MockRequest => ({
  result,
  error: null,
  onsuccess: null,
  onerror: null
});

const mockObjectStore = {
  get: vi.fn((key: string) => {
    const req = mockIDBRequest(mockStore.get(key));
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  }),
  put: vi.fn((value: StoreValue, key: string) => {
    mockStore.set(key, value);
    const req = mockIDBRequest(undefined);
    setTimeout(() => req.onsuccess?.(), 0);
    return req;
  })
};

function createMockTransaction() {
  const objectStore = vi.fn(() => mockObjectStore);
  const tx: {
    objectStore: typeof objectStore;
    oncomplete: (() => void) | null;
  } = {
    objectStore,
    oncomplete: null
  };
  setTimeout(() => tx.oncomplete?.(), 10);
  return tx;
}

const mockDB = {
  transaction: vi.fn(() => createMockTransaction()),
  close: vi.fn(),
  objectStoreNames: { contains: vi.fn(() => true) },
  createObjectStore: vi.fn()
};

type MockOpenRequest = {
  result: typeof mockDB;
  error: Error | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
  onupgradeneeded: (() => void) | null;
};

const createMockOpenRequest = (): MockOpenRequest => ({
  result: mockDB,
  error: null,
  onsuccess: null,
  onerror: null,
  onupgradeneeded: null
});

vi.stubGlobal('indexedDB', {
  open: vi.fn(() => {
    const request = createMockOpenRequest();
    setTimeout(() => request.onsuccess?.(), 0);
    return request;
  })
});

describe('orgPreference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
  });

  it('returns null when no active org is set', async () => {
    const orgId = await getActiveOrgForUser('user-1');
    expect(orgId).toBeNull();
  });

  it('persists and retrieves active org for a user', async () => {
    await setActiveOrgForUser('user-1', 'org-123');

    const orgId = await getActiveOrgForUser('user-1');
    expect(orgId).toBe('org-123');
  });

  it('stores different orgs for different users', async () => {
    await setActiveOrgForUser('user-1', 'org-a');
    await setActiveOrgForUser('user-2', 'org-b');

    const org1 = await getActiveOrgForUser('user-1');
    const org2 = await getActiveOrgForUser('user-2');
    expect(org1).toBe('org-a');
    expect(org2).toBe('org-b');
  });

  it('clears active org for a user', async () => {
    await setActiveOrgForUser('user-1', 'org-123');
    await clearActiveOrgForUser('user-1');

    const orgId = await getActiveOrgForUser('user-1');
    expect(orgId).toBeNull();
  });

  it('clearing one user does not affect another', async () => {
    await setActiveOrgForUser('user-1', 'org-a');
    await setActiveOrgForUser('user-2', 'org-b');

    await clearActiveOrgForUser('user-1');

    const org1 = await getActiveOrgForUser('user-1');
    const org2 = await getActiveOrgForUser('user-2');
    expect(org1).toBeNull();
    expect(org2).toBe('org-b');
  });
});
