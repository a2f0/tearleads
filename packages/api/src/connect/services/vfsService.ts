import {
  callRouteJsonHandler,
  encoded,
  setOptionalPositiveIntQueryParam,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';
import { deleteBlobDirect, getBlobDirect } from './vfsDirectBlobs.js';
import {
  deleteEmailDirect,
  getEmailDirect,
  getEmailsDirect,
  sendEmailDirect
} from './vfsDirectEmails.js';
import { getMyKeysDirect, setupKeysDirect } from './vfsDirectKeys.js';
import { registerDirect, rekeyItemDirect } from './vfsDirectRegistry.js';
import {
  getCrdtSnapshotDirect,
  getSyncDirect,
  reconcileSyncDirect
} from './vfsDirectSync.js';

type BlobIdRequest = { blobId: string };
type StagingIdJsonRequest = { stagingId: string; json: string };
type ItemIdJsonRequest = { itemId: string; json: string };
type GetSyncRequest = { cursor: string; limit: number; rootId: string };
type GetCrdtSnapshotRequest = { clientId: string };
type GetEmailsRequest = { offset: number; limit: number };
type EmailIdRequest = { id: string };

function queryFromGetSyncRequest(request: GetSyncRequest): URLSearchParams {
  const params = new URLSearchParams();
  setOptionalStringQueryParam(params, 'cursor', request.cursor);
  setOptionalPositiveIntQueryParam(params, 'limit', request.limit);
  setOptionalStringQueryParam(params, 'rootId', request.rootId);
  return params;
}

function stagingPathSuffix(request: StagingIdJsonRequest): string {
  return `/vfs/blobs/stage/${encoded(request.stagingId)}`;
}

export const vfsConnectService = {
  getMyKeys: async (_request: object, context: { requestHeader: Headers }) =>
    getMyKeysDirect({}, context),
  setupKeys: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => setupKeysDirect(request, context),
  register: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => registerDirect(request, context),
  getBlob: async (
    request: BlobIdRequest,
    context: { requestHeader: Headers }
  ) => getBlobDirect(request, context),
  deleteBlob: async (
    request: BlobIdRequest,
    context: { requestHeader: Headers }
  ) => deleteBlobDirect(request, context),
  stageBlob: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: '/vfs/blobs/stage',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  uploadBlobChunk: async (
    request: StagingIdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: `${stagingPathSuffix(request)}/chunks`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  attachBlob: async (
    request: StagingIdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: `${stagingPathSuffix(request)}/attach`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  abandonBlob: async (
    request: StagingIdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: `${stagingPathSuffix(request)}/abandon`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  commitBlob: async (
    request: StagingIdJsonRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: `${stagingPathSuffix(request)}/commit`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  rekeyItem: async (
    request: ItemIdJsonRequest,
    context: { requestHeader: Headers }
  ) => rekeyItemDirect(request, context),
  pushCrdtOps: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: '/vfs/crdt/push',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  reconcileCrdt: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: '/vfs/crdt/reconcile',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  reconcileSync: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => reconcileSyncDirect(request, context),
  runCrdtSession: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'POST',
      path: '/vfs/crdt/session',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  getSync: async (
    request: GetSyncRequest,
    context: { requestHeader: Headers }
  ) => getSyncDirect(request, context),
  getCrdtSync: async (
    request: GetSyncRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callRouteJsonHandler({
      context,
      method: 'GET',
      path: '/vfs/crdt/vfs-sync',
      query: queryFromGetSyncRequest(request)
    });
    return { json };
  },
  getCrdtSnapshot: async (
    request: GetCrdtSnapshotRequest,
    context: { requestHeader: Headers }
  ) => getCrdtSnapshotDirect(request, context),
  getEmails: async (
    request: GetEmailsRequest,
    context: { requestHeader: Headers }
  ) => getEmailsDirect(request, context),
  getEmail: async (
    request: EmailIdRequest,
    context: { requestHeader: Headers }
  ) => getEmailDirect(request, context),
  deleteEmail: async (
    request: EmailIdRequest,
    context: { requestHeader: Headers }
  ) => deleteEmailDirect(request, context),
  sendEmail: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => sendEmailDirect(request, context)
};
