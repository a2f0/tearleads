import { Router, type Router as RouterType } from 'express';
import { registerDeleteKeysKeyRoute } from './redis/deleteKeysKey.js';
import { registerGetDbsizeRoute } from './redis/getDbsize.js';
import { registerGetKeysRoute } from './redis/getKeys.js';
import { registerGetKeysKeyRoute } from './redis/getKeysKey.js';

const redisRouter: RouterType = Router();
registerGetKeysRoute(redisRouter);
registerGetDbsizeRoute(redisRouter);
registerGetKeysKeyRoute(redisRouter);
registerDeleteKeysKeyRoute(redisRouter);

export { redisRouter };
