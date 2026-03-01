import type { GetOrganizationBillingRequest } from '@tearleads/shared/gen/tearleads/v1/billing_pb';
import { callLegacyJsonRoute } from './legacyRouteProxy.js';

function encoded(value: string): string {
  return encodeURIComponent(value);
}

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
