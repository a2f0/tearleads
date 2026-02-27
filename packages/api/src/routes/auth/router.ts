import { Router, type Router as RouterType } from 'express';
import { registerDeleteSessionsSessionIdRoute } from './deleteSessionsSessionId.js';
import { registerGetOrganizationsRoute } from './getOrganizations.js';
import { registerGetSessionsRoute } from './getSessions.js';
import { registerPostLoginRoute } from './postLogin.js';
import { registerPostLogoutRoute } from './postLogout.js';
import { registerPostRefreshRoute } from './postRefresh.js';
import { registerPostRegisterRoute } from './postRegister.js';

const authRouter: RouterType = Router();
registerPostLoginRoute(authRouter);
registerPostRegisterRoute(authRouter);
registerPostRefreshRoute(authRouter);
registerGetSessionsRoute(authRouter);
registerGetOrganizationsRoute(authRouter);
registerDeleteSessionsSessionIdRoute(authRouter);
registerPostLogoutRoute(authRouter);

export { authRouter };
