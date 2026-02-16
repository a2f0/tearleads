import { Router, type Router as RouterType } from 'express';
import { registerGetOrganizationsOrganizationidRoute } from './billing/getOrganizationsOrganizationId.js';

const billingRouter: RouterType = Router();
registerGetOrganizationsOrganizationidRoute(billingRouter);

export { billingRouter };
