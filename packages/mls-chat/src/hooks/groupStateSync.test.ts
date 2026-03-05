import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  recoverMissingGroupState,
  uploadGroupStateSnapshot
} from './groupStateSync.js';

interface TestClient {
  hasGroup: ReturnType<typeof vi.fn>;
  importGroupState: ReturnType<typeof vi.fn>;
  exportGroupState: ReturnType<typeof vi.fn>;
  getGroupEpoch: ReturnType<typeof vi.fn>;
}

function createClient(): TestClient {
  return {
    hasGroup: vi.fn(),
    importGroupState: vi.fn(),
    exportGroupState: vi.fn(),
    getGroupEpoch: vi.fn()
  };
}

describe('groupStateSync', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recovers missing group state and imports it locally', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(false);
    client.importGroupState.mockResolvedValue(undefined);
    const serializedState = 'serialized-state';
    const stateHash = 'X/wnNsA+qEvj1bbVUIls8zjTa/wKOz17TEK532YZY1U=';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              state: {
                id: 'state-1',
                groupId: 'group-1',
                epoch: 4,
                encryptedState: btoa(serializedState),
                stateHash,
                createdAt: new Date().toISOString()
              }
            })
          )
      )
    );

    const recovered = await recoverMissingGroupState({
      groupId: 'group-1',
      client,
      apiBaseUrl: 'http://localhost/v1',
      getAuthHeader: undefined
    });

    expect(recovered).toBe(true);
    expect(client.importGroupState).toHaveBeenCalledTimes(1);
    expect(client.importGroupState.mock.calls[0]?.[0]).toBe('group-1');
    const importedBytes = client.importGroupState.mock.calls[0]?.[1] as
      | Uint8Array
      | undefined;
    expect(importedBytes).toBeDefined();
    expect(Array.from(importedBytes ?? new Uint8Array())).toEqual(
      Array.from(new TextEncoder().encode(serializedState))
    );
  });

  it('rejects recovered state when the state hash does not match', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              state: {
                id: 'state-1',
                groupId: 'group-1',
                epoch: 4,
                encryptedState: btoa('serialized-state'),
                stateHash: 'invalid-state-hash',
                createdAt: new Date().toISOString()
              }
            })
          )
      )
    );

    await expect(
      recoverMissingGroupState({
        groupId: 'group-1',
        client,
        apiBaseUrl: 'http://localhost/v1',
        getAuthHeader: undefined
      })
    ).rejects.toThrow('MLS group state hash mismatch');

    expect(client.importGroupState).not.toHaveBeenCalled();
  });

  it('returns false when server has no snapshot', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(false);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ state: null })))
    );

    const recovered = await recoverMissingGroupState({
      groupId: 'group-1',
      client,
      apiBaseUrl: 'http://localhost/v1',
      getAuthHeader: undefined
    });

    expect(recovered).toBe(false);
    expect(client.importGroupState).not.toHaveBeenCalled();
  });

  it('uploads current group snapshot when group is available', async () => {
    const client = createClient();
    client.hasGroup.mockReturnValue(true);
    client.getGroupEpoch.mockReturnValue(7);
    client.exportGroupState.mockResolvedValue(
      new TextEncoder().encode('state-bytes')
    );

    const fetchSpy = vi.fn(async () => new Response('{}', { status: 201 }));
    vi.stubGlobal('fetch', fetchSpy);

    await uploadGroupStateSnapshot({
      groupId: 'group-1',
      client,
      apiBaseUrl: 'http://localhost/v1',
      getAuthHeader: undefined
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(init?.method).toBe('POST');
    expect(typeof init?.body).toBe('string');
    const requestBody = JSON.parse((init?.body as string) ?? '{}') as {
      groupId?: string;
      json?: string;
    };
    expect(requestBody.groupId).toBe('group-1');
    expect(typeof requestBody.json).toBe('string');

    const payload = JSON.parse(requestBody.json ?? '{}') as {
      epoch?: number;
      encryptedState?: string;
      stateHash?: string;
    };
    expect(payload.epoch).toBe(7);
    expect(payload.encryptedState).toBeDefined();
    expect(payload.stateHash).toBe(
      'wAEDKaM8s6FdpeNW0sAr8nS7ZQCBwhZ0F3ClXnVBabQ='
    );
  });
});
