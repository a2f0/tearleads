import { Router, type Router as RouterType } from 'express';
import { registerDeleteSessionsSessionIdRoute } from './auth/delete-sessions-sessionId.js';
import { registerGetSessionsRoute } from './auth/get-sessions.js';
import { registerPostLoginRoute } from './auth/post-login.js';
import { registerPostLogoutRoute } from './auth/post-logout.js';
import { registerPostRefreshRoute } from './auth/post-refresh.js';
import { registerPostRegisterRoute } from './auth/post-register.js';

const authRouter: RouterType = Router();
registerPostLoginRoute(authRouter);
registerPostRegisterRoute(authRouter);
registerPostRefreshRoute(authRouter);
registerGetSessionsRoute(authRouter);
registerDeleteSessionsSessionIdRoute(authRouter);
registerPostLogoutRoute(authRouter);

export { authRouter };
