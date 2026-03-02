import { HandleWebhookRequest } from '@tearleads/shared/gen/tearleads/v1/revenuecat_pb';
import { describe, it } from 'vitest';
import { REVENUECAT_SIGNATURE_HEADER } from '../../lib/revenuecat.js';
import { chatConnectService } from './chatService.js';
import {
  createTestContext,
  useProxyFetchMock
} from './proxyServiceTestHelpers.js';
import { revenuecatConnectService } from './revenuecatService.js';

describe('auxiliary proxy services', () => {
  const { mockJsonResponse, expectLastFetch } = useProxyFetchMock();

  it('routes chat and revenuecat service methods', async () => {
    const context = createTestContext();

    const cases = [
      {
        call: () =>
          chatConnectService.postCompletions(
            { json: '{"messages":[{"role":"user","content":"hi"}]}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/chat/completions',
        method: 'POST',
        body: '{"messages":[{"role":"user","content":"hi"}]}'
      },
      {
        call: () =>
          revenuecatConnectService.handleWebhook(
            new HandleWebhookRequest({
              json: '{"event":{"id":"evt-1"}}',
              signature: 'sig-1'
            }),
            context
          ),
        url: 'http://127.0.0.1:55661/v1/revenuecat/webhooks',
        method: 'POST',
        body: '{"event":{"id":"evt-1"}}',
        expectedHeaders: {
          [REVENUECAT_SIGNATURE_HEADER]: 'sig-1'
        }
      },
      {
        call: () =>
          revenuecatConnectService.handleWebhook(
            new HandleWebhookRequest({
              json: '{"event":{"id":"evt-2"}}',
              signature: '  '
            }),
            context
          ),
        url: 'http://127.0.0.1:55661/v1/revenuecat/webhooks',
        method: 'POST',
        body: '{"event":{"id":"evt-2"}}',
        expectedHeaders: {
          [REVENUECAT_SIGNATURE_HEADER]: null
        }
      }
    ];

    for (const testCase of cases) {
      mockJsonResponse();
      await testCase.call();
      expectLastFetch(
        testCase.url,
        testCase.method,
        testCase.body,
        testCase.expectedHeaders
      );
    }
  });
});
