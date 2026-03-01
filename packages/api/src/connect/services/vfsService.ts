import {
  callLegacyBinaryRoute,
  callLegacyJsonRoute,
  encoded,
  setOptionalPositiveIntQueryParam,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';

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

function queryFromGetEmailsRequest(request: GetEmailsRequest): URLSearchParams {
  const params = new URLSearchParams();
  if (Number.isFinite(request.offset) && request.offset >= 0) {
    params.set('offset', String(Math.floor(request.offset)));
  }
  setOptionalPositiveIntQueryParam(params, 'limit', request.limit);
  return params;
}

function stagingPathSuffix(request: StagingIdJsonRequest): string {
  return `/vfs/blobs/stage/${encoded(request.stagingId)}`;
}

export const vfsConnectService = {
  getMyKeys: async (_request: object, context: { requestHeader: Headers }) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/keys/me'
    });
    return { json };
  },
  setupKeys: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/vfs/keys',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  register: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/vfs/register',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  getBlob: async (
    request: BlobIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const response = await callLegacyBinaryRoute({
      context,
      method: 'GET',
      path: `/vfs/blobs/${encoded(request.blobId)}`
    });
    const data = new Uint8Array(response.data);
    return {
      data,
      ...(response.contentType ? { contentType: response.contentType } : {})
    };
  },
  deleteBlob: async (
    request: BlobIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: `/vfs/blobs/${encoded(request.blobId)}`
    });
    return { json };
  },
  stageBlob: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: `/vfs/items/${encoded(request.itemId)}/rekey`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  pushCrdtOps: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
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
    const json = await callLegacyJsonRoute({
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
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/vfs/sync/reconcile',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  runCrdtSession: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
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
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/vfs-sync',
      query: queryFromGetSyncRequest(request)
    });
    return { json };
  },
  getCrdtSync: async (
    request: GetSyncRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
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
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(query, 'clientId', request.clientId);
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/crdt/snapshot',
      query
    });
    return { json };
  },
  getEmails: async (
    request: GetEmailsRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/emails',
      query: queryFromGetEmailsRequest(request)
    });
    return { json };
  },
  getEmail: async (
    request: EmailIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/vfs/emails/${encoded(request.id)}`
    });
    return { json };
  },
  deleteEmail: async (
    request: EmailIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: `/vfs/emails/${encoded(request.id)}`
    });
    return { json };
  },
  sendEmail: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/vfs/emails/send',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  }
};
