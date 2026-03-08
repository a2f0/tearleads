import type { VfsCrdtSyncResponse } from '@tearleads/shared';
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

  it('unwraps nested connect transport wrappers', async () => {
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

    const response = await fetchVfsConnectJson<VfsCrdtSyncResponse>({
      actor,
      methodName: 'GetCrdtSync',
      requestBody: { limit: 500 }
    });

    expect(response).toEqual(createCrdtResponse());
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
});
