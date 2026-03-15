import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  ShareTargetSearchResponse,
  UpdateVfsShareRequest,
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
  VfsUserKeysResponse,
  VfsUserSigningKeyResponse
} from '@tearleads/shared';
import {
  createConnectJsonPostInit,
  normalizeVfsCrdtSyncConnectPayload,
  normalizeVfsSyncConnectPayload,
  parseConnectJsonEnvelopeBody,
  parseConnectJsonString,
  VFS_SHARES_V2_CONNECT_BASE_PATH,
  VFS_V2_CONNECT_BASE_PATH
} from '@tearleads/shared';
import { request } from '../apiCore';

interface ConnectBlobResponse {
  data?: string | number[];
  contentType?: string;
}

interface ConnectBlobChunkResponse {
  data?: string | number[];
  chunkIndex: number;
  isFinal: boolean;
  plaintextLength: number;
  ciphertextLength: number;
  nonce: string;
  aadHash: string;
}

export interface GetBlobManifestClientResponse {
  blobId: string;
  keyEpoch: number;
  chunkCount: number;
  totalPlaintextBytes: number;
  totalCiphertextBytes: number;
  chunkHashes: string[];
  manifestHash: string;
  manifestSignature: string;
  contentType?: string;
}

export interface GetBlobChunkClientResponse {
  data: Uint8Array;
  chunkIndex: number;
  isFinal: boolean;
  plaintextLength: number;
  ciphertextLength: number;
  nonce: string;
  aadHash: string;
}

type RequestEventName = Parameters<typeof request>[1]['eventName'];

interface VfsBlobResponse {
  data: Uint8Array;
  contentType: string | null;
}

function parseConnectJsonResponse<TResponse>(responseBody: unknown): TResponse {
  const parsedPayload = parseConnectJsonEnvelopeBody(responseBody);
  if (
    parsedPayload !== null &&
    parsedPayload !== undefined &&
    typeof parsedPayload === 'object'
  ) {
    return parsedPayload as TResponse;
  }
  if (parsedPayload === null || parsedPayload === undefined) {
    // Connect no-content responses are normalized to an empty object payload.
    return parseConnectJsonString<TResponse>('{}');
  }
  throw new Error('transport returned non-object connect payload');
}

function requestVfsTyped<TResponse>(
  methodName: string,
  requestBody: Record<string, unknown>,
  eventName: RequestEventName
): Promise<TResponse> {
  return request<unknown>(`${VFS_V2_CONNECT_BASE_PATH}/${methodName}`, {
    fetchOptions: createConnectJsonPostInit(requestBody),
    eventName
  }).then((responseBody) => parseConnectJsonResponse<TResponse>(responseBody));
}

function requestVfsSharesJson<TResponse>(
  methodName: string,
  requestBody: Record<string, unknown>,
  eventName: RequestEventName
): Promise<TResponse> {
  return request<unknown>(`${VFS_SHARES_V2_CONNECT_BASE_PATH}/${methodName}`, {
    fetchOptions: createConnectJsonPostInit(requestBody),
    eventName
  }).then((responseBody) => parseConnectJsonResponse<TResponse>(responseBody));
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
    request<VfsUserKeysResponse>(`${VFS_V2_CONNECT_BASE_PATH}/GetMyKeys`, {
      fetchOptions: createConnectJsonPostInit({}),
      eventName: 'api_get_vfs_keys'
    }),
  getUserSigningKey: (userId: string) =>
    requestVfsTyped<VfsUserSigningKeyResponse>(
      'GetUserSigningKey',
      { userId },
      'api_get_vfs_user_signing_key'
    ),
  getSync: (cursor?: string, limit = 500) => {
    const requestBody: Record<string, unknown> = { limit };
    if (cursor) {
      requestBody['cursor'] = cursor;
    }
    return requestVfsTyped<unknown>(
      'GetSync',
      requestBody,
      'api_get_vfs_sync'
    ).then((response) => normalizeVfsSyncConnectPayload(response));
  },
  getCrdtSync: (cursor?: string, limit = 500) => {
    const requestBody: Record<string, unknown> = { limit };
    if (cursor) {
      requestBody['cursor'] = cursor;
    }
    return requestVfsTyped<unknown>(
      'GetCrdtSync',
      requestBody,
      'api_get_vfs_crdt_sync'
    ).then((response) => normalizeVfsCrdtSyncConnectPayload(response));
  },
  setupKeys: (data: VfsKeySetupRequest) =>
    request<{ created: boolean }>(`${VFS_V2_CONNECT_BASE_PATH}/SetupKeys`, {
      fetchOptions: createConnectJsonPostInit({
        publicEncryptionKey: data.publicEncryptionKey,
        publicSigningKey: data.publicSigningKey ?? '',
        encryptedPrivateKeys: data.encryptedPrivateKeys,
        argon2Salt: data.argon2Salt
      }),
      eventName: 'api_post_vfs_keys'
    }),
  register: (data: VfsRegisterRequest) =>
    request<VfsRegisterResponse>(`${VFS_V2_CONNECT_BASE_PATH}/Register`, {
      fetchOptions: createConnectJsonPostInit({
        id: data.id,
        objectType: data.objectType,
        encryptedSessionKey: data.encryptedSessionKey,
        ...(typeof data.encryptedName === 'string'
          ? { encryptedName: data.encryptedName }
          : {})
      }),
      eventName: 'api_post_vfs_register'
    }),
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
        shareType: data.shareType,
        targetId: data.targetId,
        permissionLevel: data.permissionLevel,
        ...(typeof data.expiresAt === 'string'
          ? { expiresAt: data.expiresAt }
          : {}),
        ...(data.wrappedKey ? { wrappedKey: data.wrappedKey } : {})
      },
      'api_post_vfs_share'
    ).then((response) => response.share),
  updateShare: (shareId: string, data: UpdateVfsShareRequest) =>
    requestVfsSharesJson<{ share: VfsShare }>(
      'UpdateShare',
      {
        shareId,
        ...(data.permissionLevel
          ? { permissionLevel: data.permissionLevel }
          : {}),
        ...(typeof data.expiresAt === 'string'
          ? { expiresAt: data.expiresAt }
          : {}),
        ...(data.expiresAt === null ? { clearExpiresAt: true } : {})
      },
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
        sourceOrgId: data.sourceOrgId,
        targetOrgId: data.targetOrgId,
        permissionLevel: data.permissionLevel,
        ...(typeof data.expiresAt === 'string'
          ? { expiresAt: data.expiresAt }
          : {}),
        ...(data.wrappedKey ? { wrappedKey: data.wrappedKey } : {})
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
      `${VFS_V2_CONNECT_BASE_PATH}/GetBlob`,
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
  getBlobManifest: async (
    blobId: string
  ): Promise<GetBlobManifestClientResponse> =>
    request<GetBlobManifestClientResponse>(
      `${VFS_V2_CONNECT_BASE_PATH}/GetBlobManifest`,
      {
        fetchOptions: createConnectJsonPostInit({ blobId }),
        eventName: 'api_get_vfs_blob_manifest'
      }
    ),
  getBlobChunk: async (
    blobId: string,
    chunkIndex: number
  ): Promise<GetBlobChunkClientResponse> => {
    const response = await request<ConnectBlobChunkResponse>(
      `${VFS_V2_CONNECT_BASE_PATH}/GetBlobChunk`,
      {
        fetchOptions: createConnectJsonPostInit({ blobId, chunkIndex }),
        eventName: 'api_get_vfs_blob_chunk'
      }
    );

    return {
      data: decodeBlobData(response.data),
      chunkIndex: response.chunkIndex,
      isFinal: response.isFinal,
      plaintextLength: response.plaintextLength,
      ciphertextLength: response.ciphertextLength,
      nonce: response.nonce,
      aadHash: response.aadHash
    };
  },
  deleteBlob: (blobId: string) =>
    request<{ deleted: boolean; blobId: string }>(
      `${VFS_V2_CONNECT_BASE_PATH}/DeleteBlob`,
      {
        fetchOptions: createConnectJsonPostInit({ blobId }),
        eventName: 'api_delete_vfs_blob'
      }
    ),
  rekeyItem: (itemId: string, data: VfsRekeyRequest) =>
    request<VfsRekeyResponse>(`${VFS_V2_CONNECT_BASE_PATH}/RekeyItem`, {
      fetchOptions: createConnectJsonPostInit({
        itemId,
        reason: data.reason,
        newEpoch: data.newEpoch,
        wrappedKeys: data.wrappedKeys
      }),
      eventName: 'api_post_vfs_rekey'
    })
};
