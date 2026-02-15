import { Router, type Router as RouterType } from 'express';
import { registerDeleteSessionsSessionIdRoute } from './auth/deleteSessionsSessionId.js';
import { registerGetSessionsRoute } from './auth/getSessions.js';
import { registerPostLoginRoute } from './auth/postLogin.js';
import { registerPostLogoutRoute } from './auth/postLogout.js';
import { registerPostRefreshRoute } from './auth/postRefresh.js';
import { registerPostRegisterRoute } from './auth/postRegister.js';

const authRouter: RouterType = Router();
registerPostLoginRoute(authRouter);
registerPostRegisterRoute(authRouter);
registerPostRefreshRoute(authRouter);
registerGetSessionsRoute(authRouter);
registerDeleteSessionsSessionIdRoute(authRouter);
registerPostLogoutRoute(authRouter);

export { authRouter };
