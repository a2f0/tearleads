/**
 * VFS (Virtual Filesystem) API routes.
 *
 * Handles user key management and VFS item registration.
 */

import { Router, type Router as RouterType } from 'express';
import { registerDeleteBlobsBlobIdRoute } from './vfs/delete-blobs-blobId.js';
import { registerGetBlobsBlobIdRoute } from './vfs/get-blobs-blobId.js';
import { registerGetCrdtSyncRoute } from './vfs/get-crdt-sync.js';
import { registerGetSyncRoute } from './vfs/get-sync.js';
import { registerGetKeysMeRoute } from './vfs/getKeysMe.js';
import { registerPostBlobsStageRoute } from './vfs/post-blobs-stage.js';
import { registerPostBlobsStageStagingIdAbandonRoute } from './vfs/post-blobs-stage-stagingId-abandon.js';
import { registerPostBlobsStageStagingIdAttachRoute } from './vfs/post-blobs-stage-stagingId-attach.js';
import { registerPostCrdtPushRoute } from './vfs/post-crdt-push.js';
import { registerPostCrdtReconcileRoute } from './vfs/post-crdt-reconcile.js';
import { registerPostItemsItemIdRekeyRoute } from './vfs/post-items-itemId-rekey.js';
import { registerPostSyncReconcileRoute } from './vfs/post-sync-reconcile.js';
import { registerPostKeysRoute } from './vfs/postKeys.js';
import { registerPostRegisterRoute } from './vfs/postRegister.js';

const vfsRouter: RouterType = Router();
registerGetKeysMeRoute(vfsRouter);
registerGetCrdtSyncRoute(vfsRouter);
registerGetSyncRoute(vfsRouter);
registerPostBlobsStageRoute(vfsRouter);
registerPostBlobsStageStagingIdAttachRoute(vfsRouter);
registerPostBlobsStageStagingIdAbandonRoute(vfsRouter);
registerGetBlobsBlobIdRoute(vfsRouter);
registerDeleteBlobsBlobIdRoute(vfsRouter);
registerPostCrdtPushRoute(vfsRouter);
registerPostCrdtReconcileRoute(vfsRouter);
registerPostKeysRoute(vfsRouter);
registerPostRegisterRoute(vfsRouter);
registerPostSyncReconcileRoute(vfsRouter);
registerPostItemsItemIdRekeyRoute(vfsRouter);

export { vfsRouter };
