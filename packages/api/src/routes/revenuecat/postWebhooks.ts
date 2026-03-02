import type { Request, Response, Router as RouterType } from 'express';
import { REVENUECAT_SIGNATURE_HEADER } from '../../lib/revenuecat.js';
import { handleRevenueCatWebhook } from '../../lib/revenuecatWebhook.js';

/**
 * @openapi
 * /revenuecat/webhooks:
 *   post:
 *     summary: Receive RevenueCat webhooks
 *     description: Ingests RevenueCat webhook events and updates organization billing state.
 *     tags:
 *       - Billing
 *     responses:
 *       200:
 *         description: Webhook accepted
 *       400:
 *         description: Invalid webhook payload
 *       401:
 *         description: Invalid webhook signature
 *       500:
 *         description: Server error
 */
const postWebhooksHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const rawBody = Buffer.isBuffer(req.body) ? req.body : null;
  const signature = req.get(REVENUECAT_SIGNATURE_HEADER) ?? null;
  const result = await handleRevenueCatWebhook({
    rawBody,
    signature
  });

  res.status(result.status).json(result.payload);
};

export function registerPostWebhooksRoute(routeRouter: RouterType): void {
  routeRouter.post('/webhooks', postWebhooksHandler);
}
