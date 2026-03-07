import type { VfsKeySetupRequest } from '@tearleads/shared';
import { attachBlobDirect } from './vfsDirectBlobAttach.js';
import {
  abandonBlobDirect,
  commitBlobDirect
} from './vfsDirectBlobFinalize.js';
import {
  type StagingIdJsonRequest,
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

type BlobIdRequest = { blobId: string };
type ItemIdJsonRequest = { itemId: string; json: string };
type GetSyncRequest = { cursor: string; limit: number; rootId: string };
type GetCrdtSnapshotRequest = { clientId: string };
type GetEmailsRequest = { offset: number; limit: number };
type EmailIdRequest = { id: string };
type SendEmailRequest = {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body?: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    content: string;
  }>;
};

export const vfsConnectService = {
  getMyKeys: async (_request: object, context: { requestHeader: Headers }) =>
    getMyKeysDirect({}, context),
  setupKeys: async (
    request: VfsKeySetupRequest,
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
  ) => stageBlobDirect(request, context),
  uploadBlobChunk: async (
    request: StagingIdJsonRequest,
    context: { requestHeader: Headers }
  ) => uploadBlobChunkDirect(request, context),
  attachBlob: async (
    request: StagingIdJsonRequest,
    context: { requestHeader: Headers }
  ) => attachBlobDirect(request, context),
  abandonBlob: async (
    request: StagingIdJsonRequest,
    context: { requestHeader: Headers }
  ) => abandonBlobDirect(request, context),
  commitBlob: async (
    request: StagingIdJsonRequest,
    context: { requestHeader: Headers }
  ) => commitBlobDirect(request, context),
  rekeyItem: async (
    request: ItemIdJsonRequest,
    context: { requestHeader: Headers }
  ) => rekeyItemDirect(request, context),
  pushCrdtOps: async (
    request: { organizationId: string; json: string },
    context: { requestHeader: Headers }
  ) => pushCrdtOpsDirect(request, context),
  reconcileCrdt: async (
    request: { organizationId?: string; json: string },
    context: { requestHeader: Headers }
  ) => reconcileCrdtDirect(request, context),
  reconcileSync: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => reconcileSyncDirect(request, context),
  runCrdtSession: async (
    request: { organizationId: string; json: string },
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
    request: SendEmailRequest,
    context: { requestHeader: Headers }
  ) => sendEmailDirect(request, context)
};
