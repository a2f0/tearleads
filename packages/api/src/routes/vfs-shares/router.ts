import { Router, type Router as RouterType } from 'express';
import { registerDeleteOrgSharesShareidRoute } from './deleteOrgSharesShareId.js';
import { registerDeleteSharesShareidRoute } from './deleteSharesShareId.js';
import { registerGetItemsItemidSharesRoute } from './getItemsItemIdShares.js';
import { registerGetShareTargetsSearchRoute } from './getShareTargetsSearch.js';
import { registerPatchSharesShareidRoute } from './patchSharesShareId.js';
import { registerPostItemsItemidOrgSharesRoute } from './postItemsItemIdOrgShares.js';
import { registerPostItemsItemidSharesRoute } from './postItemsItemIdShares.js';

const vfsSharesRouter: RouterType = Router();
registerGetItemsItemidSharesRoute(vfsSharesRouter);
registerPostItemsItemidSharesRoute(vfsSharesRouter);
registerPatchSharesShareidRoute(vfsSharesRouter);
registerDeleteSharesShareidRoute(vfsSharesRouter);
registerPostItemsItemidOrgSharesRoute(vfsSharesRouter);
registerDeleteOrgSharesShareidRoute(vfsSharesRouter);
registerGetShareTargetsSearchRoute(vfsSharesRouter);

export { vfsSharesRouter };
