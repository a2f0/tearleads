import { Router, type Router as RouterType } from 'express';
import { registerPostCompletionsRoute } from './postCompletions.js';

const chatRouter: RouterType = Router();
registerPostCompletionsRoute(chatRouter);

export { chatRouter };
