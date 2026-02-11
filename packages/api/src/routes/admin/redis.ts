import { Router, type Router as RouterType } from 'express';
import { registerDeleteKeysKeyRoute } from './redis/delete-keys-key.js';
import { registerGetDbsizeRoute } from './redis/get-dbsize.js';
import { registerGetKeysRoute } from './redis/get-keys.js';
import { registerGetKeysKeyRoute } from './redis/get-keys-key.js';

const redisRouter: RouterType = Router();
registerGetKeysRoute(redisRouter);
registerGetDbsizeRoute(redisRouter);
registerGetKeysKeyRoute(redisRouter);
registerDeleteKeysKeyRoute(redisRouter);

export { redisRouter };
