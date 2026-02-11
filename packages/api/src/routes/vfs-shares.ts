import { Router, type Router as RouterType } from 'express';
import { registerDeleteOrgSharesShareidRoute } from './vfs-shares/delete-org-shares-shareId.js';
import { registerDeleteSharesShareidRoute } from './vfs-shares/delete-shares-shareId.js';
import { registerGetItemsItemidSharesRoute } from './vfs-shares/get-items-itemId-shares.js';
import { registerGetShareTargetsSearchRoute } from './vfs-shares/get-share-targets-search.js';
import { registerPatchSharesShareidRoute } from './vfs-shares/patch-shares-shareId.js';
import { registerPostItemsItemidOrgSharesRoute } from './vfs-shares/post-items-itemId-org-shares.js';
import { registerPostItemsItemidSharesRoute } from './vfs-shares/post-items-itemId-shares.js';

const vfsSharesRouter: RouterType = Router();
registerGetItemsItemidSharesRoute(vfsSharesRouter);
registerPostItemsItemidSharesRoute(vfsSharesRouter);
registerPatchSharesShareidRoute(vfsSharesRouter);
registerDeleteSharesShareidRoute(vfsSharesRouter);
registerPostItemsItemidOrgSharesRoute(vfsSharesRouter);
registerDeleteOrgSharesShareidRoute(vfsSharesRouter);
registerGetShareTargetsSearchRoute(vfsSharesRouter);

export { vfsSharesRouter };
