import { Code, ConnectError } from '@connectrpc/connect';
import type {
  VfsKeySetupRequest,
  VfsRegisterRequest,
  VfsRekeyRequest
} from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import type {
  VfsAbandonBlobRequest,
  VfsAttachBlobRequest,
  VfsDeleteBlobRequest,
  VfsGetBlobRequest,
  VfsGetCrdtSnapshotRequest,
  VfsGetCrdtSyncRequest,
  VfsGetMyKeysRequest,
  VfsGetSyncRequest,
  VfsPushCrdtOpsRequest,
  VfsReconcileCrdtRequest,
  VfsReconcileSyncRequest,
  VfsRegisterRequest as VfsRegisterRpcRequest,
  VfsRekeyItemRequest as VfsRekeyItemRpcRequest,
  VfsRunCrdtSessionRequest,
  VfsStageBlobRequest,
  VfsUploadBlobChunkRequest
} from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
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
import {
  parseKeySetupPayload,
  parseRegisterPayload,
  parseRekeyPayload
} from './vfsDirectShared.js';
import {
  getCrdtSnapshotDirect,
  getCrdtSyncDirect,
  getSyncDirect,
  reconcileSyncDirect
} from './vfsDirectSync.js';
import {
  type DirectGetSyncRequest,
  type DirectPushCrdtOpsRequest,
  type DirectReconcileCrdtRequest,
  type DirectReconcileSyncRequest,
  type DirectRunCrdtSessionRequest,
  encodeIdentifierBytes,
  toDirectGetCrdtSyncRequest,
  toDirectGetSyncRequest,
  toDirectPushRequest,
  toDirectReconcileCrdtRequest,
  toDirectReconcileSyncRequest,
  toDirectRunCrdtSessionRequest,
  toProtoCrdtSyncResponse,
  toProtoPushResponse,
  toProtoReconcileResponse,
  toProtoSyncResponse
} from './vfsServiceSyncAdapters.js';

type BlobIdRequest = { blobId: string };
type RegisterPayloadRequest = {
  id: string;
  objectType: string;
  encryptedSessionKey: string;
  encryptedName?: string;
};
type GetCrdtSnapshotRequest = { clientId: string };
type GetEmailsRequest = { offset: number; limit: number };
type EmailIdRequest = { id: string };
type RegisterServiceRequest = VfsRegisterRpcRequest | RegisterPayloadRequest;
type RekeyItemPayloadRequest = {
  itemId: string;
  reason: string;
  newEpoch: number;
  wrappedKeys: unknown[];
};
type RekeyItemDirectRequest = { itemId: string } & VfsRekeyRequest;
type RekeyItemServiceRequest = VfsRekeyItemRpcRequest | RekeyItemPayloadRequest;

function normalizeRequiredString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseRegisterDirectRequest(
  request: RegisterServiceRequest
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
  request: RekeyItemServiceRequest
): RekeyItemDirectRequest {
  if (!isRecord(request)) {
    throw new ConnectError(
      'Invalid request payload. Please check the `reason`, `newEpoch`, and `wrappedKeys` fields.',
      Code.InvalidArgument
    );
  }

  const itemId = normalizeRequiredString(request['itemId']);
  const payload = parseRekeyPayload(request);
  if (!itemId || !payload) {
    throw new ConnectError(
      'Invalid request payload. Please check the `reason`, `newEpoch`, and `wrappedKeys` fields.',
      Code.InvalidArgument
    );
  }

  return {
    itemId,
    ...payload
  };
}

function parseSetupKeysDirectRequest(request: unknown): VfsKeySetupRequest {
  const payload = parseKeySetupPayload(request);
  if (!payload) {
    throw new ConnectError(
      'publicEncryptionKey, publicSigningKey, encryptedPrivateKeys, and argon2Salt are required',
      Code.InvalidArgument
    );
  }

  return payload;
}

export const vfsConnectService = {
  getMyKeys: async (_request: object, context: { requestHeader: Headers }) =>
    getMyKeysDirect({}, context),
  setupKeys: async (request: unknown, context: { requestHeader: Headers }) =>
    setupKeysDirect(parseSetupKeysDirectRequest(request), context),
  register: async (
    request: RegisterServiceRequest,
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
    request: RekeyItemServiceRequest,
    context: { requestHeader: Headers }
  ) => rekeyItemDirect(parseRekeyItemDirectRequest(request), context),
  pushCrdtOps: async (
    request: DirectPushCrdtOpsRequest,
    context: { requestHeader: Headers }
  ) => pushCrdtOpsDirect(request, context),
  reconcileCrdt: async (
    request: DirectReconcileCrdtRequest,
    context: { requestHeader: Headers }
  ) => reconcileCrdtDirect(request, context),
  reconcileSync: async (
    request: DirectReconcileSyncRequest,
    context: { requestHeader: Headers }
  ) => reconcileSyncDirect(request, context),
  runCrdtSession: async (
    request: DirectRunCrdtSessionRequest,
    context: { requestHeader: Headers }
  ) => runCrdtSessionDirect(request, context),
  getSync: async (
    request: DirectGetSyncRequest,
    context: { requestHeader: Headers }
  ) => getSyncDirect(request, context),
  getCrdtSync: async (
    request: DirectGetSyncRequest,
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

export const vfsConnectRouterService = {
  getMyKeys: async (
    _request: VfsGetMyKeysRequest,
    context: { requestHeader: Headers }
  ) => {
    const keys = await getMyKeysDirect({}, context);
    return {
      publicKeyIds: [keys.publicEncryptionKey, keys.publicSigningKey].filter(
        (keyId) => keyId.trim().length > 0
      )
    };
  },
  register: async (
    request: VfsRegisterRpcRequest,
    context: { requestHeader: Headers }
  ) => registerDirect(parseRegisterDirectRequest(request), context),
  getBlob: async (
    request: VfsGetBlobRequest,
    context: { requestHeader: Headers }
  ) => getBlobDirect(request, context),
  deleteBlob: async (
    request: VfsDeleteBlobRequest,
    context: { requestHeader: Headers }
  ) => deleteBlobDirect(request, context),
  stageBlob: async (
    request: VfsStageBlobRequest,
    context: { requestHeader: Headers }
  ) => stageBlobDirect(request, context),
  uploadBlobChunk: async (
    request: VfsUploadBlobChunkRequest,
    context: { requestHeader: Headers }
  ) => uploadBlobChunkDirect(request, context),
  attachBlob: async (
    request: VfsAttachBlobRequest,
    context: { requestHeader: Headers }
  ) => attachBlobDirect(request, context),
  abandonBlob: async (
    request: VfsAbandonBlobRequest,
    context: { requestHeader: Headers }
  ) => abandonBlobDirect(request, context),
  pushCrdtOps: async (
    request: VfsPushCrdtOpsRequest,
    context: { requestHeader: Headers }
  ) =>
    toProtoPushResponse(
      await pushCrdtOpsDirect(toDirectPushRequest(request), context)
    ),
  reconcileCrdt: async (
    request: VfsReconcileCrdtRequest,
    context: { requestHeader: Headers }
  ) =>
    toProtoReconcileResponse(
      await reconcileCrdtDirect(toDirectReconcileCrdtRequest(request), context)
    ),
  reconcileSync: async (
    request: VfsReconcileSyncRequest,
    context: { requestHeader: Headers }
  ) =>
    reconcileSyncDirect(toDirectReconcileSyncRequest(request), context).then(
      (response) => ({
        clientId: encodeIdentifierBytes(response.clientId),
        cursor: response.cursor
      })
    ),
  runCrdtSession: async (
    request: VfsRunCrdtSessionRequest,
    context: { requestHeader: Headers }
  ) =>
    runCrdtSessionDirect(toDirectRunCrdtSessionRequest(request), context).then(
      (response) => ({
        push: toProtoPushResponse(response.push),
        pull: toProtoCrdtSyncResponse(response.pull),
        reconcile: toProtoReconcileResponse(response.reconcile)
      })
    ),
  getSync: async (
    request: VfsGetSyncRequest,
    context: { requestHeader: Headers }
  ) =>
    getSyncDirect(toDirectGetSyncRequest(request), context).then((response) =>
      toProtoSyncResponse(response)
    ),
  getCrdtSync: async (
    request: VfsGetCrdtSyncRequest,
    context: { requestHeader: Headers }
  ) =>
    getCrdtSyncDirect(toDirectGetCrdtSyncRequest(request), context).then(
      (response) => toProtoCrdtSyncResponse(response)
    ),
  getCrdtSnapshot: async (
    request: VfsGetCrdtSnapshotRequest,
    context: { requestHeader: Headers }
  ) => getCrdtSnapshotDirect(request, context)
};
