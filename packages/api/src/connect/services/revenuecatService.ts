import type { HandleWebhookRequest } from '@tearleads/shared/gen/tearleads/v1/revenuecat_pb';
import { REVENUECAT_SIGNATURE_HEADER } from '../../lib/revenuecat.js';
import { callLegacyJsonRoute, toJsonBody } from './legacyRouteProxy.js';

export const revenuecatConnectService = {
  handleWebhook: async (
    request: HandleWebhookRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/revenuecat/webhooks',
      jsonBody: toJsonBody(request.json),
      extraHeaders: {
        [REVENUECAT_SIGNATURE_HEADER]: request.signature
      }
    });
    return { json };
  }
};
