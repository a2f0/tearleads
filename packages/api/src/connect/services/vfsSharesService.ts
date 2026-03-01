import {
  callLegacyJsonRoute,
  encoded,
  setOptionalPositiveIntQueryParam,
  setOptionalStringQueryParam,
  toJsonBody
} from './legacyRouteProxy.js';

type GetItemSharesRequest = { itemId: string };
type CreateShareRequest = { itemId: string; json: string };
type UpdateShareRequest = { shareId: string; json: string };
type ShareIdRequest = { shareId: string };
type CreateOrgShareRequest = { itemId: string; json: string };
type SearchShareTargetsRequest = { q: string; type: string };
type GetSharePolicyPreviewRequest = {
  rootItemId: string;
  principalType: string;
  principalId: string;
  limit: number;
  cursor: string;
  maxDepth: number;
  q: string;
  objectType: string[];
};

export const vfsSharesConnectService = {
  getItemShares: async (
    request: GetItemSharesRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: `/vfs/items/${encoded(request.itemId)}/shares`
    });
    return { json };
  },
  createShare: async (
    request: CreateShareRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: `/vfs/items/${encoded(request.itemId)}/shares`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  updateShare: async (
    request: UpdateShareRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'PATCH',
      path: `/vfs/shares/${encoded(request.shareId)}`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  deleteShare: async (
    request: ShareIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: `/vfs/shares/${encoded(request.shareId)}`
    });
    return { json };
  },
  createOrgShare: async (
    request: CreateOrgShareRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'POST',
      path: `/vfs/items/${encoded(request.itemId)}/org-shares`,
      jsonBody: toJsonBody(request.json)
    });
    return { json };
  },
  deleteOrgShare: async (
    request: ShareIdRequest,
    context: { requestHeader: Headers }
  ) => {
    const json = await callLegacyJsonRoute({
      context,
      method: 'DELETE',
      path: `/vfs/org-shares/${encoded(request.shareId)}`
    });
    return { json };
  },
  searchShareTargets: async (
    request: SearchShareTargetsRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(query, 'q', request.q);
    setOptionalStringQueryParam(query, 'type', request.type);
    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/share-targets/search',
      query
    });
    return { json };
  },
  getSharePolicyPreview: async (
    request: GetSharePolicyPreviewRequest,
    context: { requestHeader: Headers }
  ) => {
    const query = new URLSearchParams();
    setOptionalStringQueryParam(query, 'rootItemId', request.rootItemId);
    setOptionalStringQueryParam(query, 'principalType', request.principalType);
    setOptionalStringQueryParam(query, 'principalId', request.principalId);
    setOptionalPositiveIntQueryParam(query, 'limit', request.limit);
    setOptionalStringQueryParam(query, 'cursor', request.cursor);
    setOptionalPositiveIntQueryParam(query, 'maxDepth', request.maxDepth);
    setOptionalStringQueryParam(query, 'q', request.q);
    if (request.objectType.length > 0) {
      query.set('objectType', request.objectType.join(','));
    }

    const json = await callLegacyJsonRoute({
      context,
      method: 'GET',
      path: '/vfs/share-policies/preview',
      query
    });
    return { json };
  }
};
