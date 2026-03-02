import { Code, ConnectError, type HandlerContext } from '@connectrpc/connect';
import type { JsonRequest } from '@tearleads/shared/gen/tearleads/v1/common_pb';
import { createChatCompletion } from '../../lib/chatCompletions.js';
import { getRequiredConnectAuthContext } from '../context.js';
import { errorMessageFromPayload, toConnectCode } from './httpStatusToConnectCode.js';

function parseJsonRequestBody(json: string): unknown {
  const body = json.trim().length > 0 ? json : '{}';
  try {
    return JSON.parse(body);
  } catch {
    throw new ConnectError('Invalid JSON payload', Code.InvalidArgument);
  }
}

function toJsonResponsePayload(payload: unknown): string {
  const serialized = JSON.stringify(payload ?? {});
  return serialized ?? '{}';
}

export const chatConnectService = {
  postCompletions: async (request: JsonRequest, context: HandlerContext) => {
    const authContext = getRequiredConnectAuthContext(context);
    if (!authContext) {
      throw new ConnectError('Unauthorized', Code.Unauthenticated);
    }

    const result = await createChatCompletion({
      body: parseJsonRequestBody(request.json),
      authUserId: authContext.claims.sub
    });

    if (result.status < 200 || result.status >= 300) {
      throw new ConnectError(
        errorMessageFromPayload(
          result.payload,
          `Chat completion failed with status ${result.status}`
        ),
        toConnectCode(result.status)
      );
    }

    return {
      json: toJsonResponsePayload(result.payload)
    };
  }
};
