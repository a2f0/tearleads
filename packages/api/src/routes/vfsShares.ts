import { Router, type Router as RouterType } from 'express';
import { registerDeleteOrgSharesShareidRoute } from './vfs-shares/deleteOrgSharesShareId.js';
import { registerDeleteSharesShareidRoute } from './vfs-shares/deleteSharesShareId.js';
import { registerGetItemsItemidSharesRoute } from './vfs-shares/getItemsItemIdShares.js';
import { registerGetShareTargetsSearchRoute } from './vfs-shares/getShareTargetsSearch.js';
import { registerPatchSharesShareidRoute } from './vfs-shares/patchSharesShareId.js';
import { registerPostItemsItemidOrgSharesRoute } from './vfs-shares/postItemsItemIdOrgShares.js';
import { registerPostItemsItemidSharesRoute } from './vfs-shares/postItemsItemIdShares.js';

const vfsSharesRouter: RouterType = Router();
registerGetItemsItemidSharesRoute(vfsSharesRouter);
registerPostItemsItemidSharesRoute(vfsSharesRouter);
registerPatchSharesShareidRoute(vfsSharesRouter);
registerDeleteSharesShareidRoute(vfsSharesRouter);
registerPostItemsItemidOrgSharesRoute(vfsSharesRouter);
registerDeleteOrgSharesShareidRoute(vfsSharesRouter);
registerGetShareTargetsSearchRoute(vfsSharesRouter);

export { vfsSharesRouter };
