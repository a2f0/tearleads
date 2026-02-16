import { Router, type Router as RouterType } from 'express';
import { registerGetRootRoute } from './sse/getRoot.js';

export {
  addConnection,
  cleanupSseClient,
  closeAllSSEConnections,
  removeConnection
} from './sse/shared.js';

const sseRouter: RouterType = Router();
registerGetRootRoute(sseRouter);

export { sseRouter };
