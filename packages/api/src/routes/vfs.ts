/**
 * VFS (Virtual Filesystem) API routes.
 *
 * Handles user key management and VFS item registration.
 */

import { Router, type Router as RouterType } from 'express';
import { registerGetKeysMeRoute } from './vfs/get-keys-me.js';
import { registerPostKeysRoute } from './vfs/post-keys.js';
import { registerPostRegisterRoute } from './vfs/post-register.js';

const vfsRouter: RouterType = Router();
registerGetKeysMeRoute(vfsRouter);
registerPostKeysRoute(vfsRouter);
registerPostRegisterRoute(vfsRouter);

export { vfsRouter };
