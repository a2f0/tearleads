import { Code, ConnectError } from '@connectrpc/connect';
import type {
  CreateOrgShareRequest,
  CreateVfsShareRequest,
  UpdateVfsShareRequest
} from '@tearleads/shared';
import type {
  VfsSharesCreateOrgShareRequest,
  VfsSharesCreateShareRequest,
  VfsSharesUpdateShareRequest
} from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';
import {
  deleteOrgShareDirect,
  deleteShareDirect,
  getSharePolicyPreviewDirect,
  searchShareTargetsDirect
} from './vfsSharesDirectHandlers.js';
import {
  createShareDirect,
  updateShareDirect
} from './vfsSharesDirectMutations.js';
import { createOrgShareDirect } from './vfsSharesDirectOrgMutations.js';
import { getItemSharesDirect } from './vfsSharesDirectQueries.js';
import {
  parseCreateOrgSharePayload,
  parseCreateSharePayload,
  parseUpdateSharePayload
} from './vfsSharesDirectShared.js';

type GetItemSharesRequest = { itemId: string };
type ShareIdRequest = { shareId: string };
type SearchShareTargetsRequest = { q: string; type: string };
type GetSharePolicyPreviewRequest = {
  rootItemId: string;
  principalType: string;
  principalId: string;
  limit: number;
  cursor: string;
  maxDepth: number;
  q: string;
  objectType: string[];
};

type UpdateShareDirectRequest = { shareId: string } & UpdateVfsShareRequest;

function parseCreateShareDirectRequest(
  request: VfsSharesCreateShareRequest
): CreateVfsShareRequest {
  const payload = parseCreateSharePayload(request);
  if (!payload) {
    throw new ConnectError(
      'shareType, targetId, and permissionLevel are required',
      Code.InvalidArgument
    );
  }
  return payload;
}

function parseUpdateShareDirectRequest(
  request: VfsSharesUpdateShareRequest
): UpdateShareDirectRequest {
  if (request.clearExpiresAt && request.expiresAt !== undefined) {
    throw new ConnectError(
      'expiresAt and clearExpiresAt cannot both be set',
      Code.InvalidArgument
    );
  }
  const payload = parseUpdateSharePayload({
    permissionLevel: request.permissionLevel,
    expiresAt: request.clearExpiresAt ? null : request.expiresAt
  });
  if (!payload) {
    throw new ConnectError('Invalid update payload', Code.InvalidArgument);
  }
  if (
    payload.permissionLevel === undefined &&
    payload.expiresAt === undefined
  ) {
    throw new ConnectError('No fields to update', Code.InvalidArgument);
  }
  return {
    shareId: request.shareId,
    ...payload
  };
}

function parseCreateOrgShareDirectRequest(
  request: VfsSharesCreateOrgShareRequest
): CreateOrgShareRequest {
  const payload = parseCreateOrgSharePayload(request);
  if (!payload) {
    throw new ConnectError(
      'sourceOrgId, targetOrgId, and permissionLevel are required',
      Code.InvalidArgument
    );
  }
  return payload;
}

export const vfsSharesConnectService = {
  getItemShares: async (
    request: GetItemSharesRequest,
    context: { requestHeader: Headers }
  ) => getItemSharesDirect(request, context),
  createShare: async (
    request: VfsSharesCreateShareRequest,
    context: { requestHeader: Headers }
  ) => createShareDirect(parseCreateShareDirectRequest(request), context),
  updateShare: async (
    request: VfsSharesUpdateShareRequest,
    context: { requestHeader: Headers }
  ) => updateShareDirect(parseUpdateShareDirectRequest(request), context),
  deleteShare: (request: ShareIdRequest, context: { requestHeader: Headers }) =>
    deleteShareDirect(request, context),
  createOrgShare: async (
    request: VfsSharesCreateOrgShareRequest,
    context: { requestHeader: Headers }
  ) => createOrgShareDirect(parseCreateOrgShareDirectRequest(request), context),
  deleteOrgShare: (
    request: ShareIdRequest,
    context: { requestHeader: Headers }
  ) => deleteOrgShareDirect(request, context),
  searchShareTargets: (
    request: SearchShareTargetsRequest,
    context: { requestHeader: Headers }
  ) => searchShareTargetsDirect(request, context),
  getSharePolicyPreview: (
    request: GetSharePolicyPreviewRequest,
    context: { requestHeader: Headers }
  ) => getSharePolicyPreviewDirect(request, context)
};
