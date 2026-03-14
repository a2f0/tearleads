import { Code, ConnectError } from '@connectrpc/connect';
import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  UpdateVfsShareRequest,
  VfsPermissionLevel,
  VfsSharePolicyPreviewRequest
} from '@tearleads/shared';
import type {
  VfsSharesCreateOrgShareRequest,
  VfsSharesCreateShareRequest,
  VfsSharesDeleteOrgShareRequest,
  VfsSharesDeleteShareRequest,
  VfsSharesGetItemSharesRequest,
  VfsSharesGetSharePolicyPreviewRequest,
  VfsSharesSearchShareTargetsRequest,
  VfsSharesUpdateShareRequest
} from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';
import {
  deleteOrgShareDirect,
  deleteShareDirect,
  getItemSharesDirect,
  getSharePolicyPreviewDirect,
  searchShareTargetsDirect
} from './vfsSharesDirectHandlers.js';
import {
  createShareDirect,
  updateShareDirect
} from './vfsSharesDirectMutations.js';
import { createOrgShareDirect } from './vfsSharesDirectOrgMutations.js';
import {
  parseCreateOrgSharePayload,
  parseCreateSharePayload,
  parseUpdateSharePayload
} from './vfsSharesDirectShared.js';

type ShareIdRequest = { shareId: string };
type GetItemSharesRequest = { itemId: string };
type SearchShareTargetsRequest = { q: string; type?: string; limit?: number };

function normalizeShareId(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new ConnectError('shareId is required', Code.InvalidArgument);
  }

  return trimmed;
}

function isVfsPermissionLevel(value: string): value is VfsPermissionLevel {
  return value === 'view' || value === 'edit' || value === 'download';
}

function normalizeUpdateShareRequest(request: UpdateVfsShareRequest): {
  shareId: string;
  permissionLevel?: VfsPermissionLevel;
  expiresAt?: string | null;
} {
  const shareId = normalizeShareId(request.shareId);
  if (request.clearExpiresAt && request.expiresAt !== undefined) {
    throw new ConnectError(
      'expiresAt and clearExpiresAt cannot both be provided',
      Code.InvalidArgument
    );
  }

  const payload = parseUpdateSharePayload(request);
  if (!payload) {
    throw new ConnectError('Invalid update payload', Code.InvalidArgument);
  }

  const normalizedRequest: {
    shareId: string;
    permissionLevel?: VfsPermissionLevel;
    expiresAt?: string | null;
  } = { shareId };

  if (
    payload.permissionLevel !== undefined &&
    payload.permissionLevel !== null
  ) {
    normalizedRequest.permissionLevel = payload.permissionLevel;
  }

  if (request.clearExpiresAt) {
    normalizedRequest.expiresAt = null;
    return normalizedRequest;
  }

  if (
    normalizedRequest.permissionLevel === undefined &&
    payload.expiresAt === undefined
  ) {
    throw new ConnectError('No fields to update', Code.InvalidArgument);
  }

  if (payload.expiresAt !== undefined) {
    normalizedRequest.expiresAt = payload.expiresAt;
  }

  return normalizedRequest;
}

export const vfsSharesConnectService = {
  getItemShares: (
    request: GetItemSharesRequest,
    context: { requestHeader: Headers }
  ) => getItemSharesDirect(request, context),
  createShare: async (
    request: CreateVfsShareRequest,
    context: { requestHeader: Headers }
  ) => {
    const payload = parseCreateSharePayload(request);
    if (!payload) {
      throw new ConnectError(
        'shareType, targetId, and permissionLevel are required',
        Code.InvalidArgument
      );
    }

    return createShareDirect(payload, context);
  },
  createOrgShare: async (
    request: CreateOrgShareRequest,
    context: { requestHeader: Headers }
  ) => {
    const payload = parseCreateOrgSharePayload(request);
    if (!payload) {
      throw new ConnectError(
        'sourceOrgId, targetOrgId, and permissionLevel are required',
        Code.InvalidArgument
      );
    }

    return createOrgShareDirect(payload, context);
  },
  updateShare: async (
    request: UpdateVfsShareRequest,
    context: { requestHeader: Headers }
  ) => updateShareDirect(normalizeUpdateShareRequest(request), context),
  deleteShare: (request: ShareIdRequest, context: { requestHeader: Headers }) =>
    deleteShareDirect(request, context),
  deleteOrgShare: (
    request: ShareIdRequest,
    context: { requestHeader: Headers }
  ) => deleteOrgShareDirect(request, context),
  searchShareTargets: (
    request: SearchShareTargetsRequest,
    context: { requestHeader: Headers }
  ) => searchShareTargetsDirect(request, context),
  getSharePolicyPreview: (
    request: VfsSharePolicyPreviewRequest,
    context: { requestHeader: Headers }
  ) => getSharePolicyPreviewDirect(request, context)
};

export const vfsSharesConnectRouterService = {
  getItemShares: (
    request: VfsSharesGetItemSharesRequest,
    context: { requestHeader: Headers }
  ) => getItemSharesDirect(request, context),
  createShare: async (
    request: VfsSharesCreateShareRequest,
    context: { requestHeader: Headers }
  ) => {
    const payload = parseCreateSharePayload(request);
    if (!payload) {
      throw new ConnectError(
        'shareType, targetId, and permissionLevel are required',
        Code.InvalidArgument
      );
    }

    return createShareDirect(payload, context);
  },
  createOrgShare: async (
    request: VfsSharesCreateOrgShareRequest,
    context: { requestHeader: Headers }
  ) => {
    const payload = parseCreateOrgSharePayload(request);
    if (!payload) {
      throw new ConnectError(
        'sourceOrgId, targetOrgId, and permissionLevel are required',
        Code.InvalidArgument
      );
    }

    return createOrgShareDirect(payload, context);
  },
  updateShare: async (
    request: VfsSharesUpdateShareRequest,
    context: { requestHeader: Headers }
  ) =>
    updateShareDirect(
      normalizeUpdateShareRequest(
        (() => {
          const normalizedRequest: UpdateVfsShareRequest = {
            shareId: request.shareId,
            clearExpiresAt: request.clearExpiresAt
          };

          if (
            typeof request.permissionLevel === 'string' &&
            isVfsPermissionLevel(request.permissionLevel)
          ) {
            normalizedRequest.permissionLevel = request.permissionLevel;
          }

          if (typeof request.expiresAt === 'string') {
            normalizedRequest.expiresAt = request.expiresAt;
          }

          return normalizedRequest;
        })()
      ),
      context
    ),
  deleteShare: (
    request: VfsSharesDeleteShareRequest,
    context: { requestHeader: Headers }
  ) => deleteShareDirect(request, context),
  deleteOrgShare: (
    request: VfsSharesDeleteOrgShareRequest,
    context: { requestHeader: Headers }
  ) => deleteOrgShareDirect(request, context),
  searchShareTargets: (
    request: VfsSharesSearchShareTargetsRequest,
    context: { requestHeader: Headers }
  ) => searchShareTargetsDirect(request, context),
  getSharePolicyPreview: (
    request: VfsSharesGetSharePolicyPreviewRequest,
    context: { requestHeader: Headers }
  ) => getSharePolicyPreviewDirect(request, context)
};
