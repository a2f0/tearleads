import {
  createShareDirect,
  updateShareDirect
} from './vfsSharesDirectMutations.js';
import {
  deleteOrgShareDirect,
  deleteShareDirect,
  getSharePolicyPreviewDirect,
  searchShareTargetsDirect
} from './vfsSharesDirectHandlers.js';
import { createOrgShareDirect } from './vfsSharesDirectOrgMutations.js';
import { getItemSharesDirect } from './vfsSharesDirectQueries.js';

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
  ) => getItemSharesDirect(request, context),
  createShare: async (
    request: CreateShareRequest,
    context: { requestHeader: Headers }
  ) => createShareDirect(request, context),
  updateShare: async (
    request: UpdateShareRequest,
    context: { requestHeader: Headers }
  ) => updateShareDirect(request, context),
  deleteShare: (request: ShareIdRequest, context: { requestHeader: Headers }) =>
    deleteShareDirect(request, context),
  createOrgShare: async (
    request: CreateOrgShareRequest,
    context: { requestHeader: Headers }
  ) => createOrgShareDirect(request, context),
  deleteOrgShare: (
    request: ShareIdRequest,
    context: { requestHeader: Headers }
  ) => deleteOrgShareDirect(request, context),
  searchShareTargets: (
    request: SearchShareTargetsRequest,
    context: { requestHeader: Headers }
  ) => searchShareTargetsDirect(request, context),
  getSharePolicyPreview: (
    request: GetSharePolicyPreviewRequest,
    context: { requestHeader: Headers }
  ) => getSharePolicyPreviewDirect(request, context)
};
