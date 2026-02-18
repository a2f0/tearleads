import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  ShareTargetSearchResponse,
  UpdateVfsShareRequest,
  VfsKeySetupRequest,
  VfsOrgShare,
  VfsRegisterRequest,
  VfsRegisterResponse,
  VfsShare,
  VfsSharesResponse,
  VfsShareType,
  VfsUserKeysResponse
} from '@tearleads/shared';
import { request, requestResponse } from '../apiCore';

export interface VfsBlobResponse {
  data: Uint8Array;
  contentType: string | null;
}

export const vfsRoutes = {
  getMyKeys: () =>
    request<VfsUserKeysResponse>('/vfs/keys/me', {
      eventName: 'api_get_vfs_keys'
    }),
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
  createShare: (data: CreateVfsShareRequest) =>
    request<{ share: VfsShare }>(
      `/vfs/items/${encodeURIComponent(data.itemId)}/shares`,
      {
        fetchOptions: {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            shareType: data.shareType,
            targetId: data.targetId,
            permissionLevel: data.permissionLevel,
            expiresAt: data.expiresAt
          })
        },
        eventName: 'api_post_vfs_share'
      }
    ).then((r) => r.share),
  updateShare: (shareId: string, data: UpdateVfsShareRequest) =>
    request<{ share: VfsShare }>(`/vfs/shares/${encodeURIComponent(shareId)}`, {
      fetchOptions: {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      },
      eventName: 'api_patch_vfs_share'
    }).then((r) => r.share),
  deleteShare: (shareId: string) =>
    request<{ deleted: boolean }>(
      `/vfs/shares/${encodeURIComponent(shareId)}`,
      {
        fetchOptions: { method: 'DELETE' },
        eventName: 'api_delete_vfs_share'
      }
    ),
  createOrgShare: (data: CreateOrgShareRequest) =>
    request<{ orgShare: VfsOrgShare }>(
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
    ).then((r) => r.orgShare),
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
    )
};
