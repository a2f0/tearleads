import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect';
import type {
  GetUsageRequest,
  GetUsageSummaryRequest,
  RecordUsageRequest
} from '@tearleads/shared/gen/tearleads/v1/ai_pb';
import { getRequiredConnectAuthContext } from '../context.js';
import {
  getUsageForUser,
  getUsageSummaryForUser,
  recordUsageForUser
} from './aiUsageService.js';

function getAuthUserId(context: HandlerContext): string {
  const authContext = getRequiredConnectAuthContext(context);
  if (!authContext) {
    throw new ConnectError('Unauthorized', Code.Unauthenticated);
  }
  return authContext.claims.sub;
}

export const aiConnectService = {
  recordUsage: async (request: RecordUsageRequest, context: HandlerContext) =>
    recordUsageForUser(getAuthUserId(context), request),
  getUsage: async (request: GetUsageRequest, context: HandlerContext) =>
    getUsageForUser(getAuthUserId(context), request),
  getUsageSummary: async (
    request: GetUsageSummaryRequest,
    context: HandlerContext
  ) => getUsageSummaryForUser(getAuthUserId(context), request)
};
