import type { VfsCrdtSyncResponse, VfsSyncResponse } from '@tearleads/shared';
import { VFS_V2_CONNECT_BASE_PATH } from '@tearleads/shared';
import { describe, expect, it, vi } from 'vitest';
import { fetchVfsConnectJson } from './vfsConnectClient.js';

function createCrdtResponse(): VfsCrdtSyncResponse {
  return {
    items: [],
    hasMore: false,
    nextCursor: null,
    lastReconciledWriteIds: {}
  };
}

describe('fetchVfsConnectJson', () => {
  it('parses connect envelopes with a json string payload', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({
        json: JSON.stringify(createCrdtResponse())
      })
    };

    const response = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: { limit: 500 }
    });

    expect(response).toEqual(createCrdtResponse());
    expect(actor.fetchJson).toHaveBeenCalledWith(
      `${VFS_V2_CONNECT_BASE_PATH}/GetCrdtSync`,
      expect.objectContaining({
        method: 'POST'
      })
    );
  });

  it('accepts already-decoded response bodies', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue(createCrdtResponse())
    };

    const response = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: { limit: 500 }
    });

    expect(response).toEqual(createCrdtResponse());
  });

  it('unwraps result wrappers returned by connect transport', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({
        result: createCrdtResponse()
      })
    };

    const response = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: { limit: 500 }
    });

    expect(response).toEqual(createCrdtResponse());
  });

  it('rejects unsupported nested wrapper chains', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({
        result: {
          message: {
            value: {
              result: {
                json: createCrdtResponse()
              }
            }
          }
        }
      })
    };

    await expect(
      fetchVfsConnectJson<VfsCrdtSyncResponse>({
        actor,
        methodName: 'GetCrdtSync',
        requestBody: { limit: 500 }
      })
    ).rejects.toThrow('transport returned unsupported connect wrapper payload');
  });

  it('unwraps envelopes with non-string json values', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({
        json: createCrdtResponse()
      })
    };

    const response = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: { limit: 500 }
    });

    expect(response).toEqual(createCrdtResponse());
  });

  it('fills omitted protobuf default fields for empty sync responses', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({})
    };

    const response = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: { limit: 500 }
    });

    expect(response).toEqual(createCrdtResponse());
  });

  it('normalizes lastReconciledWriteIds values for direct payloads', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({
        lastReconciledWriteIds: {
          desktop: 8,
          mobile: 0,
          '   ': 1
        }
      })
    };

    const response = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: { limit: 500 }
    });

    expect(response).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false,
      lastReconciledWriteIds: {
        desktop: 8
      }
    });
  });

  it('normalizes omitted sync defaults for GetSync responses', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({})
    };

    const response = await fetchVfsConnectJson<VfsSyncResponse>({
      actor,
      methodName: 'GetSync',
      requestBody: { limit: 500 }
    });

    expect(response).toEqual({
      items: [],
      nextCursor: null,
      hasMore: false
    });
  });

  it('passes through non-sync connect payloads', async () => {
    const actor = {
      fetchJson: vi.fn().mockResolvedValue({ created: true })
    };

    const response = await fetchVfsConnectJson<{ created: boolean }>({
      actor,
      methodName: 'SetupKeys'
    });

    expect(response).toEqual({ created: true });
  });

  it('rejects non-object connect payloads', async () => {
    const stringActor = {
      fetchJson: vi.fn().mockResolvedValue('{"created": true}')
    };
    const nullActor = {
      fetchJson: vi.fn().mockResolvedValue(null)
    };

    await expect(
      fetchVfsConnectJson<{ created: boolean }>({
        actor: stringActor,
        methodName: 'SetupKeys'
      })
    ).rejects.toThrow('transport returned non-object connect payload');

    await expect(
      fetchVfsConnectJson<{ created: boolean }>({
        actor: nullActor,
        methodName: 'SetupKeys'
      })
    ).rejects.toThrow('transport returned non-object connect payload');
  });
});
