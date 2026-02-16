import { Router, type Router as RouterType } from 'express';
import { registerPostCompletionsRoute } from './chat/postCompletions.js';

const chatRouter: RouterType = Router();
registerPostCompletionsRoute(chatRouter);

export { chatRouter };
