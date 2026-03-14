import { Code, ConnectError } from '@connectrpc/connect';
import type { VfsKeySetupRequest } from '@tearleads/shared';
import { isRecord } from '@tearleads/shared';
import type {
  VfsAbandonBlobRequest,
  VfsAttachBlobRequest,
  VfsCommitBlobRequest,
  VfsDeleteBlobRequest,
  VfsDeleteEmailRequest,
  VfsGetBlobRequest,
  VfsGetCrdtSnapshotRequest,
  VfsGetCrdtSyncRequest,
  VfsGetEmailRequest,
  VfsGetEmailsRequest,
  VfsGetMyKeysRequest,
  VfsGetSyncRequest,
  VfsPushCrdtOpsRequest,
  VfsReconcileCrdtRequest,
  VfsReconcileSyncRequest,
  VfsRegisterRequest as VfsRegisterRpcRequest,
  VfsRekeyItemRequest as VfsRekeyItemRpcRequest,
  VfsRunCrdtSessionRequest,
  VfsSendEmailRequest,
  VfsSetupKeysRequest,
  VfsStageBlobRequest,
  VfsUploadBlobChunkRequest
} from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import { attachBlobDirect } from './vfsDirectBlobAttach.js';
import {
  abandonBlobDirect,
  commitBlobDirect
} from './vfsDirectBlobFinalize.js';
import type { CommitBlobRequest } from './vfsDirectBlobShared.js';
import {
  normalizeRequiredString,
  parseBlobCommitBody
} from './vfsDirectBlobShared.js';
import {
  stageBlobDirect,
  uploadBlobChunkDirect
} from './vfsDirectBlobStageUpload.js';
import { deleteBlobDirect, getBlobDirect } from './vfsDirectBlobs.js';
import { pushCrdtOpsDirect } from './vfsDirectCrdtPush.js';
import { reconcileCrdtDirect } from './vfsDirectCrdtReconcile.js';
import { runCrdtSessionDirect } from './vfsDirectCrdtSession.js';
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
  getCrdtSyncDirect,
  getSyncDirect,
  reconcileSyncDirect
} from './vfsDirectSync.js';
import {
  parseRegisterDirectRequest,
  parseRekeyItemDirectRequest,
  parseSetupKeysDirectRequest
} from './vfsService.js';
import {
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

function parseCommitBlobDirectRequest(request: unknown): CommitBlobRequest {
  if (!isRecord(request)) {
    throw new ConnectError('commit payload is invalid', Code.InvalidArgument);
  }

  const stagingId = normalizeRequiredString(request['stagingId']);
  const payload = parseBlobCommitBody(request);
  if (!stagingId || !payload) {
    throw new ConnectError('commit payload is invalid', Code.InvalidArgument);
  }

  return {
    stagingId,
    ...payload
  };
}

export const vfsConnectRouterService = {
  getMyKeys: async (
    _request: VfsGetMyKeysRequest,
    context: { requestHeader: Headers }
  ) => {
    const keys = await getMyKeysDirect({}, context);
    return {
      publicKeyIds: [keys.publicEncryptionKey, keys.publicSigningKey].filter(
        (keyId) => keyId.trim().length > 0
      ),
      publicEncryptionKey: keys.publicEncryptionKey,
      publicSigningKey: keys.publicSigningKey,
      ...(keys.encryptedPrivateKeys
        ? { encryptedPrivateKeys: keys.encryptedPrivateKeys }
        : {}),
      ...(keys.argon2Salt ? { argon2Salt: keys.argon2Salt } : {})
    };
  },
  setupKeys: async (
    request: VfsSetupKeysRequest | VfsKeySetupRequest | Record<string, unknown>,
    context: { requestHeader: Headers }
  ) => {
    const response = await setupKeysDirect(
      parseSetupKeysDirectRequest(request),
      context
    );
    return {
      success: response.created,
      created: response.created
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
  commitBlob: async (
    request: VfsCommitBlobRequest | CommitBlobRequest | Record<string, unknown>,
    context: { requestHeader: Headers }
  ) => {
    const response = await commitBlobDirect(
      parseCommitBlobDirectRequest(request),
      context
    );
    return {
      success: response.committed,
      blobId: response.blobId,
      committed: response.committed,
      stagingId: response.stagingId,
      uploadId: response.uploadId
    };
  },
  rekeyItem: async (
    request: VfsRekeyItemRpcRequest | Record<string, unknown>,
    context: { requestHeader: Headers }
  ) => rekeyItemDirect(parseRekeyItemDirectRequest(request), context),
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
  ) => getCrdtSnapshotDirect(request, context),
  getEmails: async (
    request: VfsGetEmailsRequest,
    context: { requestHeader: Headers }
  ) => {
    const response = await getEmailsDirect(
      {
        offset: 0,
        limit:
          typeof request.limit === 'number' && Number.isFinite(request.limit)
            ? request.limit
            : 50
      },
      context
    );
    return {
      items: response.emails.map((email) => ({
        id: email.id,
        threadId: email.id,
        from: email.from,
        to: email.to,
        subject: email.subject,
        snippet: '',
        receivedAt: email.receivedAt,
        isRead: false,
        hasAttachments: false
      })),
      ...(typeof request.cursor === 'string' && request.cursor.length > 0
        ? { nextCursor: request.cursor }
        : {})
    };
  },
  getEmail: async (
    request: VfsGetEmailRequest,
    context: { requestHeader: Headers }
  ) => {
    const response = await getEmailDirect(request, context);
    return {
      id: response.id,
      threadId: response.id,
      from: response.from,
      to: response.to,
      cc: [],
      bcc: [],
      subject: response.subject,
      bodyHtml: '',
      bodyText: response.rawData,
      receivedAt: response.receivedAt,
      headers: []
    };
  },
  deleteEmail: async (
    request: VfsDeleteEmailRequest,
    context: { requestHeader: Headers }
  ) => deleteEmailDirect(request, context),
  sendEmail: async (
    request: VfsSendEmailRequest,
    context: { requestHeader: Headers }
  ) =>
    sendEmailDirect(
      {
        to: request.to,
        cc: request.cc,
        bcc: request.bcc,
        subject: request.subject,
        body: request.body,
        attachments: request.attachments.map((attachment) => ({
          fileName: attachment.name,
          content: attachment.contentBase64,
          mimeType: attachment.contentType
        }))
      },
      context
    )
};
