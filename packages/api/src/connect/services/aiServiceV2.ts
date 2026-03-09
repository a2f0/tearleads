import { ConnectError } from '@connectrpc/connect';
import type {
  AiServiceGetUsageRequest,
  AiServiceGetUsageSummaryRequest
} from '@tearleads/shared/gen/tearleads/v2/ai_pb';
import { getUsageForUser, getUsageSummaryForUser } from './aiUsageService.js';
import { authenticate } from './connectRequestAuth.js';
import { toConnectCode } from './httpStatusToConnectCode.js';

type ConnectContext = { requestHeader: Headers };

async function getAuthUserId(requestHeader: Headers): Promise<string> {
  const authResult = await authenticate(requestHeader);
  if (!authResult.ok) {
    throw new ConnectError(authResult.error, toConnectCode(authResult.status));
  }

  return authResult.claims.sub;
}

export const aiConnectServiceV2 = {
  async getUsage(request: AiServiceGetUsageRequest, context: ConnectContext) {
    return getUsageForUser(await getAuthUserId(context.requestHeader), request);
  },
  async getUsageSummary(
    request: AiServiceGetUsageSummaryRequest,
    context: ConnectContext
  ) {
    return getUsageSummaryForUser(
      await getAuthUserId(context.requestHeader),
      request
    );
  }
};
