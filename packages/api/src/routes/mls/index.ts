import { Router, type Router as RouterType } from 'express';
import { groupsRouter } from './groups.js';
import { keyPackagesRouter } from './keyPackages.js';
import { messagesRouter } from './messages.js';
import { welcomesRouter } from './welcomes.js';

const router: RouterType = Router();

// KeyPackage routes
router.use('/key-packages', keyPackagesRouter);

// Group routes (includes message routes)
router.use('/groups', groupsRouter);
router.use('/groups', messagesRouter);

// Welcome routes
router.use('/welcomes', welcomesRouter);

export { router as mlsRouter };
