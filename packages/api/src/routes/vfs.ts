/**
 * VFS (Virtual Filesystem) API routes.
 *
 * Handles user key management and VFS item registration.
 */

import { Router, type Router as RouterType } from 'express';
import { registerGetKeysMeRoute } from './vfs/getKeysMe.js';
import { registerGetSyncRoute } from './vfs/get-sync.js';
import { registerPostBlobsStageRoute } from './vfs/post-blobs-stage.js';
import { registerPostBlobsStageStagingIdAbandonRoute } from './vfs/post-blobs-stage-stagingId-abandon.js';
import { registerPostBlobsStageStagingIdAttachRoute } from './vfs/post-blobs-stage-stagingId-attach.js';
import { registerPostKeysRoute } from './vfs/postKeys.js';
import { registerPostRegisterRoute } from './vfs/postRegister.js';
import { registerPostSyncReconcileRoute } from './vfs/post-sync-reconcile.js';

const vfsRouter: RouterType = Router();
registerGetKeysMeRoute(vfsRouter);
registerGetSyncRoute(vfsRouter);
registerPostBlobsStageRoute(vfsRouter);
registerPostBlobsStageStagingIdAttachRoute(vfsRouter);
registerPostBlobsStageStagingIdAbandonRoute(vfsRouter);
registerPostKeysRoute(vfsRouter);
registerPostRegisterRoute(vfsRouter);
registerPostSyncReconcileRoute(vfsRouter);

export { vfsRouter };
