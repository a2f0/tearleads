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
import { request, requestResponse } from '../apiCore';

interface VfsBlobResponse {
  data: Uint8Array;
  contentType: string | null;
}

export const vfsRoutes = {
  getMyKeys: () =>
    request<VfsUserKeysResponse>('/vfs/keys/me', {
      eventName: 'api_get_vfs_keys'
    }),
  getSync: (cursor?: string, limit = 500) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (cursor) {
      params.set('cursor', cursor);
    }
    return request<VfsSyncResponse>(`/vfs/vfs-sync?${params.toString()}`, {
      eventName: 'api_get_vfs_sync'
    });
  },
  getCrdtSync: (cursor?: string, limit = 500) => {
    const params = new URLSearchParams();
    params.set('limit', String(limit));
    if (cursor) {
      params.set('cursor', cursor);
    }
    return request<VfsCrdtSyncResponse>(
      `/vfs/crdt/vfs-sync?${params.toString()}`,
      {
        eventName: 'api_get_vfs_crdt_sync'
      }
    );
  },
  setupKeys: (data: VfsKeySetupRequest) =>
    request<{ created: boolean }>('/vfs/keys', {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      eventName: 'api_post_vfs_keys'
    }),
  register: (data: VfsRegisterRequest) =>
    request<VfsRegisterResponse>('/vfs/register', {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      eventName: 'api_post_vfs_register'
    }),
  getShares: (itemId: string) =>
    request<VfsSharesResponse>(
      `/vfs/items/${encodeURIComponent(itemId)}/shares`,
      {
        eventName: 'api_get_vfs_shares'
      }
    ),
  createShare: async (data: CreateVfsShareRequest): Promise<VfsShare> => {
    const response = await request<{ share: VfsShare }>(
      `/vfs/items/${encodeURIComponent(data.itemId)}/shares`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shareType: data.shareType,
            targetId: data.targetId,
            permissionLevel: data.permissionLevel,
            expiresAt: data.expiresAt,
            wrappedKey: data.wrappedKey
          })
        },
        eventName: 'api_post_vfs_share'
      }
    );
    return response.share;
  },
  updateShare: async (
    shareId: string,
    data: UpdateVfsShareRequest
  ): Promise<VfsShare> => {
    const response = await request<{ share: VfsShare }>(
      `/vfs/shares/${encodeURIComponent(shareId)}`,
      {
        fetchOptions: {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_patch_vfs_share'
      }
    );
    return response.share;
  },
  deleteShare: (shareId: string) =>
    request<{ deleted: boolean }>(
      `/vfs/shares/${encodeURIComponent(shareId)}`,
      {
        fetchOptions: { method: 'DELETE' },
        eventName: 'api_delete_vfs_share'
      }
    ),
  createOrgShare: async (data: CreateOrgShareRequest): Promise<VfsOrgShare> => {
    const { orgShare } = await request<{ orgShare: VfsOrgShare }>(
      `/vfs/items/${encodeURIComponent(data.itemId)}/org-shares`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sourceOrgId: data.sourceOrgId,
            targetOrgId: data.targetOrgId,
            permissionLevel: data.permissionLevel,
            expiresAt: data.expiresAt
          })
        },
        eventName: 'api_post_vfs_org_share'
      }
    );
    return orgShare;
  },
  deleteOrgShare: (shareId: string) =>
    request<{ deleted: boolean }>(
      `/vfs/org-shares/${encodeURIComponent(shareId)}`,
      {
        fetchOptions: { method: 'DELETE' },
        eventName: 'api_delete_vfs_org_share'
      }
    ),
  searchShareTargets: (query: string, type?: VfsShareType) => {
    const params = new URLSearchParams({ q: query });
    if (type) params.set('type', type);
    return request<ShareTargetSearchResponse>(
      `/vfs/share-targets/search?${params.toString()}`,
      { eventName: 'api_get_vfs_share_targets' }
    );
  },
  getSharePolicyPreview: (requestParams: VfsSharePolicyPreviewRequest) => {
    const params = new URLSearchParams({
      rootItemId: requestParams.rootItemId,
      principalType: requestParams.principalType,
      principalId: requestParams.principalId
    });
    if (requestParams.limit !== undefined) {
      params.set('limit', String(requestParams.limit));
    }
    if (requestParams.cursor) {
      params.set('cursor', requestParams.cursor);
    }
    if (
      requestParams.maxDepth !== undefined &&
      requestParams.maxDepth !== null
    ) {
      params.set('maxDepth', String(requestParams.maxDepth));
    }
    if (requestParams.q) {
      params.set('q', requestParams.q);
    }
    if (requestParams.objectType && requestParams.objectType.length > 0) {
      params.set('objectType', requestParams.objectType.join(','));
    }
    return request<VfsSharePolicyPreviewResponse>(
      `/vfs/share-policies/preview?${params.toString()}`,
      {
        eventName: 'api_get_vfs_share_policy_preview'
      }
    );
  },
  getBlob: async (blobId: string): Promise<VfsBlobResponse> => {
    const response = await requestResponse(
      `/vfs/blobs/${encodeURIComponent(blobId)}`,
      {
        eventName: 'api_get_vfs_blob'
      }
    );
    const data = new Uint8Array(await response.arrayBuffer());
    return {
      data,
      contentType: response.headers.get('content-type')
    };
  },
  deleteBlob: (blobId: string) =>
    request<{ deleted: boolean; blobId: string }>(
      `/vfs/blobs/${encodeURIComponent(blobId)}`,
      {
        fetchOptions: { method: 'DELETE' },
        eventName: 'api_delete_vfs_blob'
      }
    ),
  rekeyItem: (itemId: string, data: VfsRekeyRequest) =>
    request<VfsRekeyResponse>(
      `/vfs/items/${encodeURIComponent(itemId)}/rekey`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        },
        eventName: 'api_post_vfs_rekey'
      }
    )
};
