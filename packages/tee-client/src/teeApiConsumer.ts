import {
  parseTeeEchoResponse,
  TEE_ECHO_PATH,
  type TeeEchoRequest,
  type TeeEchoResponse
} from '@tearleads/tee-api';
import type { TeeClient, TeeSecurityAssertions } from './teeClient.js';

export interface TeeEchoConsumerResponse {
  response: TeeEchoResponse;
  assertions: TeeSecurityAssertions;
}

export interface TeeApiConsumer {
  echo(message: string): Promise<TeeEchoConsumerResponse>;
}

export function createTeeApiConsumer(client: TeeClient): TeeApiConsumer {
  return {
    async echo(message: string): Promise<TeeEchoConsumerResponse> {
      const requestBody: TeeEchoRequest = {
        message
      };

      const response = await client.request({
        path: TEE_ECHO_PATH,
        method: 'POST',
        body: requestBody
      });

      return {
        response: parseTeeEchoResponse(response.data),
        assertions: response.assertions
      };
    }
  };
}
