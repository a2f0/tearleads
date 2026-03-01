import { describe, it } from 'vitest';
import { aiConnectService } from './aiService.js';
import { billingConnectService } from './billingService.js';
import { chatConnectService } from './chatService.js';
import {
  createTestContext,
  useProxyFetchMock
} from './proxyServiceTestHelpers.js';

describe('auxiliary proxy services', () => {
  const { mockJsonResponse, expectLastFetch } = useProxyFetchMock();

  it('routes ai, billing, and chat service methods', async () => {
    const context = createTestContext();

    const cases = [
      {
        call: () =>
          aiConnectService.recordUsage({ json: '{"modelId":"m1"}' }, context),
        url: 'http://127.0.0.1:55661/v1/ai/usage',
        method: 'POST',
        body: '{"modelId":"m1"}'
      },
      {
        call: () =>
          aiConnectService.getUsage(
            {
              startDate: '2026-01-01',
              endDate: '2026-01-31',
              cursor: 'cursor-1',
              limit: 25
            },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/ai/usage?startDate=2026-01-01&endDate=2026-01-31&cursor=cursor-1&limit=25',
        method: 'GET'
      },
      {
        call: () =>
          aiConnectService.getUsageSummary(
            {
              startDate: '2026-02-01',
              endDate: '2026-02-28'
            },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/ai/usage/summary?startDate=2026-02-01&endDate=2026-02-28',
        method: 'GET'
      },
      {
        call: () =>
          billingConnectService.getOrganizationBilling(
            { organizationId: 'org-billing-1' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/billing/organizations/org-billing-1',
        method: 'GET'
      },
      {
        call: () =>
          chatConnectService.postCompletions(
            { json: '{"messages":[{"role":"user","content":"hi"}]}' },
            context
          ),
        url: 'http://127.0.0.1:55661/v1/chat/completions',
        method: 'POST',
        body: '{"messages":[{"role":"user","content":"hi"}]}'
      }
    ];

    for (const testCase of cases) {
      mockJsonResponse();
      await testCase.call();
      expectLastFetch(testCase.url, testCase.method, testCase.body);
    }
  });
});
