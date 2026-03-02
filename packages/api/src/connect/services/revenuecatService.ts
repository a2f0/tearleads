import { callLegacyJsonRoute, toJsonBody } from './legacyRouteProxy.js';

type HandleWebhookRequest = { json: string; signature: string };

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
        'x-revenuecat-signature': request.signature
      }
    });
    return { json };
  }
};
