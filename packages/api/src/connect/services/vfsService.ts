import { Code, ConnectError } from '@connectrpc/connect';
import type {
  VfsRegisterRequest as VfsRegisterRpcRequest,
  VfsRekeyItemRequest as VfsRekeyItemRpcRequest
} from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import {
  type VfsKeySetupRequest,
  type VfsRegisterRequest,
  type VfsRekeyRequest
} from '@tearleads/shared';
import { attachBlobDirect } from './vfsDirectBlobAttach.js';
import {
  abandonBlobDirect,
  commitBlobDirect
} from './vfsDirectBlobFinalize.js';
import type {
  AttachBlobRequest,
  CommitBlobRequest,
  StageBlobRequest,
  StagingIdRequest,
  UploadBlobChunkRequest
} from './vfsDirectBlobShared.js';
import {
  stageBlobDirect,
  uploadBlobChunkDirect
} from './vfsDirectBlobStageUpload.js';
import { deleteBlobDirect, getBlobDirect } from './vfsDirectBlobs.js';
import { pushCrdtOpsDirect } from './vfsDirectCrdtPush.js';
import { reconcileCrdtDirect } from './vfsDirectCrdtReconcile.js';
import { runCrdtSessionDirect } from './vfsDirectCrdtSession.js';
import type { SendRequestPayload } from './vfsDirectEmailPayload.js';
import {
  deleteEmailDirect,
  getEmailDirect,
  getEmailsDirect,
  sendEmailDirect
} from './vfsDirectEmails.js';
import { getMyKeysDirect, setupKeysDirect } from './vfsDirectKeys.js';
import { registerDirect, rekeyItemDirect } from './vfsDirectRegistry.js';
import { parseRegisterPayload, parseRekeyPayload } from './vfsDirectShared.js';
import {
  getCrdtSnapshotDirect,
  getCrdtSyncDirect,
  getSyncDirect,
  reconcileSyncDirect
} from './vfsDirectSync.js';

type BlobIdRequest = { blobId: string };
type GetSyncRequest = { cursor: string; limit: number; rootId: string };
type GetCrdtSnapshotRequest = { clientId: string };
type ReconcileSyncRequest = { clientId: string; cursor: string };
type ReconcileCrdtRequest = {
  organizationId: string;
  clientId: string;
  cursor: string;
  lastReconciledWriteIds: Record<string, number>;
};
type PushCrdtOpsRequest = {
  organizationId: string;
  clientId: string;
  operations: unknown[];
};
type RunCrdtSessionRequest = {
  organizationId: string;
  clientId: string;
  cursor: string;
  limit: number;
  operations: unknown[];
  lastReconciledWriteIds: Record<string, number>;
  rootId?: string | null;
};
type GetEmailsRequest = { offset: number; limit: number };
type EmailIdRequest = { id: string };
type RekeyItemDirectRequest = { itemId: string } & VfsRekeyRequest;

function parseRegisterDirectRequest(
  request: VfsRegisterRpcRequest
): VfsRegisterRequest {
  const payload = parseRegisterPayload(request);
  if (!payload) {
    throw new ConnectError(
      'id, objectType, and encryptedSessionKey are required',
      Code.InvalidArgument
    );
  }

  return payload;
}

function parseRekeyItemDirectRequest(
  request: VfsRekeyItemRpcRequest
): RekeyItemDirectRequest {
  const payload = parseRekeyPayload(request);
  if (!payload) {
    throw new ConnectError(
      'Invalid request payload. Please check the `reason`, `newEpoch`, and `wrappedKeys` fields.',
      Code.InvalidArgument
    );
  }

  return {
    itemId: request.itemId,
    ...payload
  };
}

export const vfsConnectService = {
  getMyKeys: async (_request: object, context: { requestHeader: Headers }) =>
    getMyKeysDirect({}, context),
  setupKeys: async (
    request: VfsKeySetupRequest,
    context: { requestHeader: Headers }
  ) => setupKeysDirect(request, context),
  register: async (
    request: VfsRegisterRpcRequest,
    context: { requestHeader: Headers }
  ) => registerDirect(parseRegisterDirectRequest(request), context),
  getBlob: async (
    request: BlobIdRequest,
    context: { requestHeader: Headers }
  ) => getBlobDirect(request, context),
  deleteBlob: async (
    request: BlobIdRequest,
    context: { requestHeader: Headers }
  ) => deleteBlobDirect(request, context),
  stageBlob: async (
    request: StageBlobRequest,
    context: { requestHeader: Headers }
  ) => stageBlobDirect(request, context),
  uploadBlobChunk: async (
    request: UploadBlobChunkRequest,
    context: { requestHeader: Headers }
  ) => uploadBlobChunkDirect(request, context),
  attachBlob: async (
    request: AttachBlobRequest,
    context: { requestHeader: Headers }
  ) => attachBlobDirect(request, context),
  abandonBlob: async (
    request: StagingIdRequest,
    context: { requestHeader: Headers }
  ) => abandonBlobDirect(request, context),
  commitBlob: async (
    request: CommitBlobRequest,
    context: { requestHeader: Headers }
  ) => commitBlobDirect(request, context),
  rekeyItem: async (
    request: VfsRekeyItemRpcRequest,
    context: { requestHeader: Headers }
  ) => rekeyItemDirect(parseRekeyItemDirectRequest(request), context),
  pushCrdtOps: async (
    request: PushCrdtOpsRequest,
    context: { requestHeader: Headers }
  ) => pushCrdtOpsDirect(request, context),
  reconcileCrdt: async (
    request: ReconcileCrdtRequest,
    context: { requestHeader: Headers }
  ) => reconcileCrdtDirect(request, context),
  reconcileSync: async (
    request: ReconcileSyncRequest,
    context: { requestHeader: Headers }
  ) => reconcileSyncDirect(request, context),
  runCrdtSession: async (
    request: RunCrdtSessionRequest,
    context: { requestHeader: Headers }
  ) => runCrdtSessionDirect(request, context),
  getSync: async (
    request: GetSyncRequest,
    context: { requestHeader: Headers }
  ) => getSyncDirect(request, context),
  getCrdtSync: async (
    request: GetSyncRequest,
    context: { requestHeader: Headers }
  ) => getCrdtSyncDirect(request, context),
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
    request: SendRequestPayload,
    context: { requestHeader: Headers }
  ) => sendEmailDirect(request, context)
};
