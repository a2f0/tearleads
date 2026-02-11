import { Router, type Router as RouterType } from 'express';
import { registerDeleteIdRoute } from './groups/delete-id.js';
import { registerDeleteIdMembersUseridRoute } from './groups/delete-id-members-userId.js';
import { registerGetIdRoute } from './groups/get-id.js';
import { registerGetIdMembersRoute } from './groups/get-id-members.js';
import { registerGetRootRoute } from './groups/get-root.js';
import { registerPostIdMembersRoute } from './groups/post-id-members.js';
import { registerPostRootRoute } from './groups/post-root.js';
import { registerPutIdRoute } from './groups/put-id.js';

const groupsRouter: RouterType = Router();
registerGetRootRoute(groupsRouter);
registerPostRootRoute(groupsRouter);
registerGetIdRoute(groupsRouter);
registerPutIdRoute(groupsRouter);
registerDeleteIdRoute(groupsRouter);
registerGetIdMembersRoute(groupsRouter);
registerPostIdMembersRoute(groupsRouter);
registerDeleteIdMembersUseridRoute(groupsRouter);

export { groupsRouter };
