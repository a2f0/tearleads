import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFromStore, setInStore } from './registryStore';

type StoreValue = unknown;
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

describe('registryStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.clear();
  });

  it('returns null for a missing key', async () => {
    const value = await getFromStore('nonexistent');
    expect(value).toBeNull();
  });

  it('round-trips a value via set then get', async () => {
    await setInStore('my-key', 'my-value');

    const result = await getFromStore<string>('my-key');
    expect(result).toBe('my-value');
  });

  it('overwrites an existing value', async () => {
    await setInStore('key', 'first');
    await setInStore('key', 'second');

    const result = await getFromStore<string>('key');
    expect(result).toBe('second');
  });
});
