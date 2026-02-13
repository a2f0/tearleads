import { Router, type Router as RouterType } from 'express';
import { registerGetOrganizationsOrganizationidRoute } from './billing/get-organizations-organizationId.js';

const billingRouter: RouterType = Router();
registerGetOrganizationsOrganizationidRoute(billingRouter);

export { billingRouter };
