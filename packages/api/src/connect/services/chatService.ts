import { callLegacyJsonRoute, toJsonBody } from './legacyRouteProxy.js';

export const chatConnectService = {
  postCompletions: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/chat/completions',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  }
};
