import { Router, type Router as RouterType } from 'express';
import { registerPostCompletionsRoute } from './chat/post-completions.js';

const chatRouter: RouterType = Router();
registerPostCompletionsRoute(chatRouter);

export { chatRouter };
