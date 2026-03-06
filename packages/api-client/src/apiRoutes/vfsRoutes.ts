import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  ShareTargetSearchResponse,
  UpdateVfsShareRequest,
  VfsCrdtSyncResponse,
  VfsKeySetupRequest,
  VfsOrgShare,
  VfsRegisterRequest,
  VfsRegisterResponse,
  VfsRekeyRequest,
  VfsRekeyResponse,
  VfsShare,
  VfsSharePolicyPreviewRequest,
  VfsSharePolicyPreviewResponse,
  VfsSharesResponse,
  VfsShareType,
  VfsSyncResponse,
  VfsUserKeysResponse
} from '@tearleads/shared';
import {
  createConnectJsonPostInit,
  parseConnectJsonString
} from '@tearleads/shared';
import { request } from '../apiCore';

const VFS_CONNECT_BASE_PATH = '/connect/tearleads.v2.VfsService';
const VFS_SHARES_CONNECT_BASE_PATH = '/connect/tearleads.v2.VfsSharesService';

interface ConnectJsonEnvelopeResponse {
  json: string;
}

interface ConnectBlobResponse {
  data?: string | number[];
  contentType?: string;
}

type RequestEventName = Parameters<typeof request>[1]['eventName'];

interface VfsBlobResponse {
  data: Uint8Array;
  contentType: string | null;
}

function requestVfsJson<TResponse>(
  methodName: string,
  requestBody: Record<string, unknown>,
  eventName: RequestEventName
): Promise<TResponse> {
  return request<ConnectJsonEnvelopeResponse>(
    `${VFS_CONNECT_BASE_PATH}/${methodName}`,
    {
      fetchOptions: createConnectJsonPostInit(requestBody),
      eventName
    }
  ).then((response) => parseConnectJsonString<TResponse>(response?.json));
}

function requestVfsSharesJson<TResponse>(
  methodName: string,
  requestBody: Record<string, unknown>,
  eventName: RequestEventName
): Promise<TResponse> {
  return request<ConnectJsonEnvelopeResponse>(
    `${VFS_SHARES_CONNECT_BASE_PATH}/${methodName}`,
    {
      fetchOptions: createConnectJsonPostInit(requestBody),
      eventName
    }
  ).then((response) => parseConnectJsonString<TResponse>(response?.json));
}

function decodeBlobData(data: string | number[] | undefined): Uint8Array {
  if (Array.isArray(data)) {
    return new Uint8Array(data);
  }
  if (typeof data !== 'string' || data.length === 0) {
    return new Uint8Array();
  }
  if (typeof atob !== 'function') {
    throw new Error('Unable to decode blob payload');
  }

  const binary = atob(data);
  const decoded = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    decoded[i] = binary.charCodeAt(i);
  }
  return decoded;
}

export const vfsRoutes = {
  getMyKeys: () =>
    requestVfsJson<VfsUserKeysResponse>('GetMyKeys', {}, 'api_get_vfs_keys'),
  getSync: (cursor?: string, limit = 500) => {
    const requestBody: Record<string, unknown> = { limit };
    if (cursor) {
      requestBody['cursor'] = cursor;
    }
    return requestVfsJson<VfsSyncResponse>(
      'GetSync',
      requestBody,
      'api_get_vfs_sync'
    );
  },
  getCrdtSync: (cursor?: string, limit = 500) => {
    const requestBody: Record<string, unknown> = { limit };
    if (cursor) {
      requestBody['cursor'] = cursor;
    }
    return requestVfsJson<VfsCrdtSyncResponse>(
      'GetCrdtSync',
      requestBody,
      'api_get_vfs_crdt_sync'
    );
  },
  setupKeys: (data: VfsKeySetupRequest) =>
    requestVfsJson<{ created: boolean }>(
      'SetupKeys',
      { json: JSON.stringify(data) },
      'api_post_vfs_keys'
    ),
  register: (data: VfsRegisterRequest) =>
    requestVfsJson<VfsRegisterResponse>(
      'Register',
      { json: JSON.stringify(data) },
      'api_post_vfs_register'
    ),
  getShares: (itemId: string) =>
    requestVfsSharesJson<VfsSharesResponse>(
      'GetItemShares',
      { itemId },
      'api_get_vfs_shares'
    ),
  createShare: (data: CreateVfsShareRequest) =>
    requestVfsSharesJson<{ share: VfsShare }>(
      'CreateShare',
      {
        itemId: data.itemId,
        json: JSON.stringify({
          shareType: data.shareType,
          targetId: data.targetId,
          permissionLevel: data.permissionLevel,
          expiresAt: data.expiresAt,
          wrappedKey: data.wrappedKey
        })
      },
      'api_post_vfs_share'
    ).then((response) => response.share),
  updateShare: (shareId: string, data: UpdateVfsShareRequest) =>
    requestVfsSharesJson<{ share: VfsShare }>(
      'UpdateShare',
      { shareId, json: JSON.stringify(data) },
      'api_patch_vfs_share'
    ).then((response) => response.share),
  deleteShare: (shareId: string) =>
    requestVfsSharesJson<{ deleted: boolean }>(
      'DeleteShare',
      { shareId },
      'api_delete_vfs_share'
    ),
  createOrgShare: (data: CreateOrgShareRequest) =>
    requestVfsSharesJson<{ orgShare: VfsOrgShare }>(
      'CreateOrgShare',
      {
        itemId: data.itemId,
        json: JSON.stringify({
          sourceOrgId: data.sourceOrgId,
          targetOrgId: data.targetOrgId,
          permissionLevel: data.permissionLevel,
          expiresAt: data.expiresAt
        })
      },
      'api_post_vfs_org_share'
    ).then((response) => response.orgShare),
  deleteOrgShare: (shareId: string) =>
    requestVfsSharesJson<{ deleted: boolean }>(
      'DeleteOrgShare',
      { shareId },
      'api_delete_vfs_org_share'
    ),
  searchShareTargets: (query: string, type?: VfsShareType) => {
    const requestBody: Record<string, unknown> = { q: query };
    if (type) {
      requestBody['type'] = type;
    }
    return requestVfsSharesJson<ShareTargetSearchResponse>(
      'SearchShareTargets',
      requestBody,
      'api_get_vfs_share_targets'
    );
  },
  getSharePolicyPreview: (requestParams: VfsSharePolicyPreviewRequest) => {
    const requestBody: Record<string, unknown> = {
      rootItemId: requestParams.rootItemId,
      principalType: requestParams.principalType,
      principalId: requestParams.principalId
    };
    if (requestParams.limit !== undefined) {
      requestBody['limit'] = requestParams.limit;
    }
    if (requestParams.cursor) {
      requestBody['cursor'] = requestParams.cursor;
    }
    if (
      requestParams.maxDepth !== undefined &&
      requestParams.maxDepth !== null
    ) {
      requestBody['maxDepth'] = requestParams.maxDepth;
    }
    if (requestParams.q) {
      requestBody['q'] = requestParams.q;
    }
    if (requestParams.objectType && requestParams.objectType.length > 0) {
      requestBody['objectType'] = requestParams.objectType;
    }

    return requestVfsSharesJson<VfsSharePolicyPreviewResponse>(
      'GetSharePolicyPreview',
      requestBody,
      'api_get_vfs_share_policy_preview'
    );
  },
  getBlob: async (blobId: string): Promise<VfsBlobResponse> => {
    const response = await request<ConnectBlobResponse>(
      `${VFS_CONNECT_BASE_PATH}/GetBlob`,
      {
        fetchOptions: createConnectJsonPostInit({ blobId }),
        eventName: 'api_get_vfs_blob'
      }
    );

    return {
      data: decodeBlobData(response.data),
      contentType: response.contentType ?? null
    };
  },
  deleteBlob: (blobId: string) =>
    requestVfsJson<{ deleted: boolean; blobId: string }>(
      'DeleteBlob',
      { blobId },
      'api_delete_vfs_blob'
    ),
  rekeyItem: (itemId: string, data: VfsRekeyRequest) =>
    requestVfsJson<VfsRekeyResponse>(
      'RekeyItem',
      { itemId, json: JSON.stringify(data) },
      'api_post_vfs_rekey'
    )
};
