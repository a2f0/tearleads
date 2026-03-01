import {
  callLegacyJsonRoute,
  setOptionalPositiveIntQueryParam,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';

type GetUsageRequest = {
  startDate: string;
  endDate: string;
  cursor: string;
  limit: number;
};
type GetUsageSummaryRequest = {
  startDate: string;
  endDate: string;
};

export const aiConnectService = {
  recordUsage: async (
    request: { json: string },
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: '/ai/usage',
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  getUsage: async (
    request: GetUsageRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(query, 'startDate', request.startDate);
    setOptionalStringQueryParam(query, 'endDate', request.endDate);
    setOptionalStringQueryParam(query, 'cursor', request.cursor);
    setOptionalPositiveIntQueryParam(query, 'limit', request.limit);

    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/ai/usage',
      query
    });
    return { json };
  },
  getUsageSummary: async (
    request: GetUsageSummaryRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(query, 'startDate', request.startDate);
    setOptionalStringQueryParam(query, 'endDate', request.endDate);

    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/ai/usage/summary',
      query
    });
    return { json };
  }
};
