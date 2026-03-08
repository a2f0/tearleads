import { Code, ConnectError } from '@connectrpc/connect';
import {
  isRecord,
  type CreateOrgShareRequest,
  type CreateVfsShareRequest,
  type UpdateVfsShareRequest
} from '@tearleads/shared';
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
type CreateShareLegacyRequest = {
  itemId: string;
  shareType: string;
  targetId: string;
  permissionLevel: string;
  expiresAt?: string;
  wrappedKey?: CreateVfsShareRequest['wrappedKey'];
};
type RpcJsonRequestWithItemId = {
  itemId: string;
  json: string;
};
type CreateShareRpcRequest = CreateShareLegacyRequest | RpcJsonRequestWithItemId;
type UpdateShareLegacyRequest = {
  shareId: string;
  permissionLevel?: string;
  expiresAt?: string;
  clearExpiresAt: boolean;
};
type RpcJsonRequestWithShareId = {
  shareId: string;
  json: string;
};
type UpdateShareRpcRequest = UpdateShareLegacyRequest | RpcJsonRequestWithShareId;
type ShareIdRequest = { shareId: string };
type CreateOrgShareLegacyRequest = {
  itemId: string;
  sourceOrgId: string;
  targetOrgId: string;
  permissionLevel: string;
  expiresAt?: string;
  wrappedKey?: CreateOrgShareRequest['wrappedKey'];
};
type CreateOrgShareRpcRequest =
  | CreateOrgShareLegacyRequest
  | RpcJsonRequestWithItemId;
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
  request: CreateShareRpcRequest
): CreateVfsShareRequest {
  const payloadInput: unknown =
    'json' in request
      ? {
          ...parseJsonRecord(request.json, 'createShare json payload'),
          itemId: request.itemId
        }
      : request;
  const payload = parseCreateSharePayload(payloadInput);
  if (!payload) {
    throw new ConnectError(
      'shareType, targetId, and permissionLevel are required',
      Code.InvalidArgument
    );
  }
  return payload;
}

function parseUpdateShareDirectRequest(
  request: UpdateShareRpcRequest
): UpdateShareDirectRequest {
  if (
    'clearExpiresAt' in request &&
    request.clearExpiresAt &&
    request.expiresAt !== undefined
  ) {
    throw new ConnectError(
      'expiresAt and clearExpiresAt cannot both be set',
      Code.InvalidArgument
    );
  }
  const payloadInput: unknown =
    'json' in request
      ? parseJsonRecord(request.json, 'updateShare json payload')
      : {
          permissionLevel: request.permissionLevel,
          expiresAt: request.clearExpiresAt ? null : request.expiresAt
        };
  const payload = parseUpdateSharePayload(payloadInput);
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
  request: CreateOrgShareRpcRequest
): CreateOrgShareRequest {
  const payloadInput: unknown =
    'json' in request
      ? {
          ...parseJsonRecord(request.json, 'createOrgShare json payload'),
          itemId: request.itemId
        }
      : request;
  const payload = parseCreateOrgSharePayload(payloadInput);
  if (!payload) {
    throw new ConnectError(
      'sourceOrgId, targetOrgId, and permissionLevel are required',
      Code.InvalidArgument
    );
  }
  return payload;
}

function parseJsonRecord(
  json: string,
  contextLabel: string
): Record<string, unknown> {
  if (!json.trim()) {
    throw new ConnectError(`${contextLabel} is required`, Code.InvalidArgument);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ConnectError(
      `${contextLabel} must be valid JSON`,
      Code.InvalidArgument
    );
  }

  if (!isRecord(parsed)) {
    throw new ConnectError(
      `${contextLabel} must be a JSON object`,
      Code.InvalidArgument
    );
  }

  return parsed;
}

export const vfsSharesConnectService = {
  getItemShares: async (
    request: GetItemSharesRequest,
    context: { requestHeader: Headers }
  ) => getItemSharesDirect(request, context),
  createShare: async (
    request: CreateShareRpcRequest,
    context: { requestHeader: Headers }
  ) => createShareDirect(parseCreateShareDirectRequest(request), context),
  updateShare: async (
    request: UpdateShareRpcRequest,
    context: { requestHeader: Headers }
  ) => updateShareDirect(parseUpdateShareDirectRequest(request), context),
  deleteShare: (request: ShareIdRequest, context: { requestHeader: Headers }) =>
    deleteShareDirect(request, context),
  createOrgShare: async (
    request: CreateOrgShareRpcRequest,
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
