import { Router, type Router as RouterType } from 'express';
import { registerGetOrganizationsOrganizationidRoute } from './getOrganizationsOrganizationId.js';

const billingRouter: RouterType = Router();
registerGetOrganizationsOrganizationidRoute(billingRouter);

export { billingRouter };
