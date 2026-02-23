import { Router, type Router as RouterType } from 'express';
import { registerGetRootRoute } from './getRoot.js';

export {
  addConnection,
  cleanupSseClient,
  closeAllSSEConnections,
  removeConnection
} from './shared.js';

const sseRouter: RouterType = Router();
registerGetRootRoute(sseRouter);

export { sseRouter };
