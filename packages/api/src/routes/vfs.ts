/**
 * VFS (Virtual Filesystem) API routes.
 *
 * Handles user key management and VFS item registration.
 */

import { Router, type Router as RouterType } from 'express';
import { registerGetKeysMeRoute } from './vfs/getKeysMe.js';
import { registerGetSyncRoute } from './vfs/get-sync.js';
import { registerPostKeysRoute } from './vfs/postKeys.js';
import { registerPostRegisterRoute } from './vfs/postRegister.js';

const vfsRouter: RouterType = Router();
registerGetKeysMeRoute(vfsRouter);
registerGetSyncRoute(vfsRouter);
registerPostKeysRoute(vfsRouter);
registerPostRegisterRoute(vfsRouter);

export { vfsRouter };
