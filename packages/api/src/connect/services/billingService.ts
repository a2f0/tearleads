import { callLegacyJsonRoute, encoded } from './legacyRouteProxy.js';

type GetOrganizationBillingRequest = { organizationId: string };

export const billingConnectService = {
  getOrganizationBilling: async (
    request: GetOrganizationBillingRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/billing/organizations/${encoded(request.organizationId)}`
    });
    return { json };
  }
};
