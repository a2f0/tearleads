/**
 * VFS (Virtual Filesystem) API routes.
 *
 * Handles user key management and VFS item registration.
 */

import { Router, type Router as RouterType } from 'express';
import { registerDeleteBlobsBlobIdRoute } from './delete-blobs-blobId.js';
import { registerDeleteEmailsIdRoute } from './delete-emails-id.js';
import { registerGetBlobsBlobIdRoute } from './get-blobs-blobId.js';
import { registerGetCrdtSnapshotRoute } from './getCrdtSnapshot.js';
import { registerGetCrdtSyncRoute } from './get-crdt-sync.js';
import { registerGetEmailsRoute } from './get-emails.js';
import { registerGetEmailsIdRoute } from './get-emails-id.js';
import { registerGetSyncRoute } from './get-sync.js';
import { registerGetKeysMeRoute } from './getKeysMe.js';
import { registerPostBlobsStageRoute } from './post-blobs-stage.js';
import { registerPostBlobsStageStagingIdAbandonRoute } from './post-blobs-stage-stagingId-abandon.js';
import { registerPostBlobsStageStagingIdAttachRoute } from './post-blobs-stage-stagingId-attach.js';
import { registerPostBlobsStageStagingIdChunksRoute } from './post-blobs-stage-stagingId-chunks.js';
import { registerPostBlobsStageStagingIdCommitRoute } from './post-blobs-stage-stagingId-commit.js';
import { registerPostCrdtPushRoute } from './post-crdt-push.js';
import { registerPostCrdtReconcileRoute } from './post-crdt-reconcile.js';
import { registerPostCrdtSessionRoute } from './postCrdtSession.js';
import { registerPostItemsItemIdRekeyRoute } from './post-items-itemId-rekey.js';
import { registerPostSyncReconcileRoute } from './post-sync-reconcile.js';
import { registerPostEmailsSendRoute } from './postEmailsSend.js';
import { registerPostKeysRoute } from './postKeys.js';
import { registerPostRegisterRoute } from './postRegister.js';

const vfsRouter: RouterType = Router();
registerGetKeysMeRoute(vfsRouter);
registerGetCrdtSyncRoute(vfsRouter);
registerGetCrdtSnapshotRoute(vfsRouter);
registerGetSyncRoute(vfsRouter);
registerPostBlobsStageRoute(vfsRouter);
registerPostBlobsStageStagingIdAttachRoute(vfsRouter);
registerPostBlobsStageStagingIdAbandonRoute(vfsRouter);
registerPostBlobsStageStagingIdChunksRoute(vfsRouter);
registerPostBlobsStageStagingIdCommitRoute(vfsRouter);
registerGetBlobsBlobIdRoute(vfsRouter);
registerDeleteBlobsBlobIdRoute(vfsRouter);
registerGetEmailsRoute(vfsRouter);
registerGetEmailsIdRoute(vfsRouter);
registerDeleteEmailsIdRoute(vfsRouter);
registerPostEmailsSendRoute(vfsRouter);
registerPostCrdtSessionRoute(vfsRouter);
registerPostCrdtPushRoute(vfsRouter);
registerPostCrdtReconcileRoute(vfsRouter);
registerPostKeysRoute(vfsRouter);
registerPostRegisterRoute(vfsRouter);
registerPostSyncReconcileRoute(vfsRouter);
registerPostItemsItemIdRekeyRoute(vfsRouter);

export { vfsRouter };
