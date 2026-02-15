import { Router, type Router as RouterType } from 'express';
import { registerDeleteIdRoute } from './groups/deleteId.js';
import { registerDeleteIdMembersUseridRoute } from './groups/deleteIdMembersUserId.js';
import { registerGetIdRoute } from './groups/getId.js';
import { registerGetIdMembersRoute } from './groups/getIdMembers.js';
import { registerGetRootRoute } from './groups/getRoot.js';
import { registerPostIdMembersRoute } from './groups/postIdMembers.js';
import { registerPostRootRoute } from './groups/postRoot.js';
import { registerPutIdRoute } from './groups/putId.js';

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
