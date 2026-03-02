import { ConnectError } from '@connectrpc/connect';
import type { HandleWebhookRequest } from '@tearleads/shared/gen/tearleads/v1/revenuecat_pb';
import { handleRevenueCatWebhook } from '../../lib/revenuecatWebhook.js';
import { errorMessageFromPayload, toConnectCode } from './httpStatusToConnectCode.js';

function normalizeJsonBody(json: string): string {
  return json.trim().length > 0 ? json : '{}';
}

function normalizeSignature(signature: string): string | null {
  return signature.trim().length > 0 ? signature : null;
}

function toJsonResponsePayload(payload: unknown): string {
  const serialized = JSON.stringify(payload ?? {});
  return serialized ?? '{}';
}

export const revenuecatConnectService = {
  handleWebhook: async (request: HandleWebhookRequest) => {
    const result = await handleRevenueCatWebhook({
      rawBody: Buffer.from(normalizeJsonBody(request.json), 'utf8'),
      signature: normalizeSignature(request.signature)
    });

    if (result.status < 200 || result.status >= 300) {
      throw new ConnectError(
        errorMessageFromPayload(
          result.payload,
          `RevenueCat webhook failed with status ${result.status}`
        ),
        toConnectCode(result.status)
      );
    }

    return {
      json: toJsonResponsePayload(result.payload)
    };
  }
};
