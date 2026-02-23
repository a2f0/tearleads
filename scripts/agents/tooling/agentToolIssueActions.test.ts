import assert from 'node:assert/strict';
import test from 'node:test';
import { Octokit } from '@octokit/rest';
import type { GitHubClientContext } from './utils/githubClient.ts';
import {
  getDependabotAlertWithOctokit,
  listDependabotAlertsWithOctokit,
  updateDependabotAlertWithOctokit
} from './utils/octokitDependabotHandlers.ts';
import {
  createIssueWithOctokit,
  findExistingIssueWithOctokit,
  getIssueWithOctokit,
  listDeferredFixIssuesWithOctokit
} from './utils/octokitIssueHandlers.ts';
import {
  checkGeminiQuotaWithOctokit,
  findDeferredWorkWithOctokit,
  replyToReviewCommentWithOctokit,
  resolveThreadWithOctokit
} from './utils/octokitReviewHandlers.ts';

function toUrlString(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createContext(
  responder: (url: string, method: string) => { status: number; body: unknown }
): GitHubClientContext {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = toUrlString(input);
    const method = init?.method ?? 'GET';
    const { status, body } = responder(url, method);
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  };

  const octokit = new Octokit({
    auth: 'test-token',
    request: { fetch: mockFetch }
  });

  return {
    octokit,
    owner: 'a2f0',
    repo: 'tearleads'
  };
}

test('listDeferredFixIssuesWithOctokit returns normalized issue list', async () => {
  const context = createContext((url) => {
    if (url.includes('/repos/a2f0/tearleads/issues')) {
      return {
        status: 200,
        body: [
          {
            number: 11,
            title: 'PR masquerading in issues API',
            html_url: 'https://example.com/pull/11',
            state: 'open',
            pull_request: {
              url: 'https://api.github.com/repos/a2f0/tearleads/pulls/11'
            }
          },
          {
            number: 12,
            title: 'chore: deferred fixes from PR #123',
            html_url: 'https://example.com/issues/12',
            state: 'open'
          }
        ]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await listDeferredFixIssuesWithOctokit(context, 'open', 5);
  const parsed = JSON.parse(output);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].number, 12);
  assert.equal(parsed[0].state, 'open');
});

test('getIssueWithOctokit returns normalized issue payload', async () => {
  const context = createContext((url) => {
    if (url.endsWith('/repos/a2f0/tearleads/issues/27')) {
      return {
        status: 200,
        body: {
          number: 27,
          title: 'Deferred fix issue',
          body: 'Body',
          html_url: 'https://example.com/issues/27',
          state: 'open',
          labels: [
            { id: 1, name: 'deferred-fix', description: null, color: '1d76db' }
          ]
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getIssueWithOctokit(context, 27);
  const parsed = JSON.parse(output);

  assert.equal(parsed.number, 27);
  assert.equal(parsed.title, 'Deferred fix issue');
  assert.equal(parsed.labels[0].name, 'deferred-fix');
});

test('findExistingIssueWithOctokit returns first matching issue', async () => {
  const context = createContext((url) => {
    if (url.includes('/search/issues')) {
      return {
        status: 200,
        body: {
          total_count: 1,
          incomplete_results: false,
          items: [
            {
              number: 52,
              title: 'feat: improve repo id lookup',
              html_url: 'https://example.com/issues/52'
            }
          ]
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const existingIssue = await findExistingIssueWithOctokit(
    context,
    'is:open in:title "repo id lookup"'
  );

  assert.deepEqual(existingIssue, {
    number: 52,
    title: 'feat: improve repo id lookup',
    url: 'https://example.com/issues/52'
  });
});

test('createIssueWithOctokit returns created issue URL', async () => {
  const context = createContext((url, method) => {
    if (url.endsWith('/repos/a2f0/tearleads/issues') && method === 'POST') {
      return {
        status: 201,
        body: {
          html_url: 'https://example.com/issues/2001'
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const issueUrl = await createIssueWithOctokit(context, {
    title: 'feat: add issue creator',
    body: 'Template body',
    labels: ['deferred-fix']
  });

  assert.equal(issueUrl, 'https://example.com/issues/2001');
});

test('listDependabotAlertsWithOctokit returns normalized alert payload', async () => {
  const context = createContext((url) => {
    if (url.includes('/repos/a2f0/tearleads/dependabot/alerts')) {
      return {
        status: 200,
        body: [
          {
            number: 64,
            state: 'open',
            dependency: {
              package: { ecosystem: 'npm', name: 'ajv' },
              manifest_path: 'pnpm-lock.yaml',
              scope: 'runtime',
              relationship: 'transitive'
            },
            security_advisory: {
              ghsa_id: 'GHSA-2g4f-4pwh-qvx6',
              cve_id: 'CVE-2025-69873',
              summary: 'ajv has ReDoS when using $data option',
              severity: 'medium'
            },
            security_vulnerability: {
              severity: 'medium',
              vulnerable_version_range: '< 6.14.0',
              first_patched_version: { identifier: '6.14.0' }
            },
            html_url:
              'https://github.com/a2f0/tearleads/security/dependabot/64',
            created_at: '2026-02-20T22:39:19Z',
            updated_at: '2026-02-20T22:39:19Z',
            dismissed_at: null,
            dismissed_reason: null,
            dismissed_comment: null,
            fixed_at: null
          }
        ]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await listDependabotAlertsWithOctokit(context, {
    state: 'open'
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.total, 1);
  assert.equal(parsed.alerts[0].number, 64);
  assert.equal(parsed.alerts[0].dependency.name, 'ajv');
});

test('getDependabotAlertWithOctokit returns normalized alert payload', async () => {
  const context = createContext((url) => {
    if (url.endsWith('/repos/a2f0/tearleads/dependabot/alerts/61')) {
      return {
        status: 200,
        body: {
          number: 61,
          state: 'dismissed',
          dependency: {
            package: { ecosystem: 'npm', name: 'minimatch' },
            manifest_path: 'pnpm-lock.yaml',
            scope: 'runtime',
            relationship: 'transitive'
          },
          security_advisory: {
            ghsa_id: 'GHSA-3ppc-4f35-3m26',
            cve_id: 'CVE-2026-26996',
            summary: 'minimatch has ReDoS',
            severity: 'high'
          },
          security_vulnerability: {
            severity: 'high',
            vulnerable_version_range: '< 10.2.1',
            first_patched_version: { identifier: '10.2.1' }
          },
          html_url: 'https://github.com/a2f0/tearleads/security/dependabot/61',
          created_at: '2026-02-18T22:53:25Z',
          updated_at: '2026-02-21T10:00:00Z',
          dismissed_at: '2026-02-21T10:00:00Z',
          dismissed_reason: 'tolerable_risk',
          dismissed_comment: 'Validated low impact',
          fixed_at: null
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getDependabotAlertWithOctokit(context, 61);
  const parsed = JSON.parse(output);

  assert.equal(parsed.number, 61);
  assert.equal(parsed.state, 'dismissed');
  assert.equal(parsed.dismissed_reason, 'tolerable_risk');
});

test('updateDependabotAlertWithOctokit sends dismiss payload', async () => {
  const context = createContext((url, method) => {
    if (
      method === 'PATCH' &&
      url.endsWith('/repos/a2f0/tearleads/dependabot/alerts/64')
    ) {
      return {
        status: 200,
        body: {
          number: 64,
          state: 'dismissed',
          dependency: {
            package: { ecosystem: 'npm', name: 'ajv' },
            manifest_path: 'pnpm-lock.yaml',
            scope: 'runtime',
            relationship: 'transitive'
          },
          security_advisory: {
            ghsa_id: 'GHSA-2g4f-4pwh-qvx6',
            cve_id: 'CVE-2025-69873',
            summary: 'ajv has ReDoS',
            severity: 'medium'
          },
          security_vulnerability: {
            severity: 'medium',
            vulnerable_version_range: '< 6.14.0',
            first_patched_version: { identifier: '6.14.0' }
          },
          html_url: 'https://github.com/a2f0/tearleads/security/dependabot/64',
          created_at: '2026-02-20T22:39:19Z',
          updated_at: '2026-02-22T08:00:00Z',
          dismissed_at: '2026-02-22T08:00:00Z',
          dismissed_reason: 'not_used',
          dismissed_comment: 'Not reachable in runtime',
          fixed_at: null
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await updateDependabotAlertWithOctokit(context, {
    alertNumber: 64,
    state: 'dismissed',
    dismissedReason: 'not_used',
    dismissedComment: 'Not reachable in runtime'
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.number, 64);
  assert.equal(parsed.state, 'dismissed');
  assert.equal(parsed.dismissed_reason, 'not_used');
  assert.equal(parsed.dismissed_comment, 'Not reachable in runtime');
});

test('updateDependabotAlertWithOctokit validates dismiss reason', async () => {
  const context = createContext(() => ({
    status: 404,
    body: { message: 'not found' }
  }));

  await assert.rejects(
    updateDependabotAlertWithOctokit(context, {
      alertNumber: 64,
      state: 'dismissed'
    }),
    /requires --dismissed-reason/
  );
});

test('replyToReviewCommentWithOctokit returns normalized reply payload', async () => {
  const context = createContext((url, method) => {
    if (
      method === 'POST' &&
      url.endsWith('/repos/a2f0/tearleads/pulls/42/comments/7/replies')
    ) {
      return {
        status: 201,
        body: {
          id: 8001,
          html_url: 'https://example.com/review-comment/8001',
          body: 'Thanks for the feedback'
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await replyToReviewCommentWithOctokit(
    context,
    42,
    7,
    'Thanks for the feedback'
  );
  const parsed = JSON.parse(output);

  assert.equal(parsed.id, 8001);
  assert.equal(parsed.url, 'https://example.com/review-comment/8001');
});

test('resolveThreadWithOctokit resolves review thread', async () => {
  const context = createContext((url, method) => {
    if (method === 'POST' && url.endsWith('/graphql')) {
      return {
        status: 200,
        body: {
          data: {
            resolveReviewThread: {
              thread: { isResolved: true }
            }
          }
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await resolveThreadWithOctokit(context, 'PRRT_abc123');
  const parsed = JSON.parse(output);

  assert.equal(parsed.resolveReviewThread.thread.isResolved, true);
});

test('findDeferredWorkWithOctokit returns matched deferred comments', async () => {
  const context = createContext((url) => {
    if (url.includes('/repos/a2f0/tearleads/pulls/42/comments')) {
      return {
        status: 200,
        body: [
          {
            id: 101,
            path: 'src/a.ts',
            line: 10,
            body: 'TODO defer for future PR',
            html_url: 'https://example.com/review/101'
          },
          {
            id: 102,
            path: 'src/b.ts',
            line: 11,
            body: 'Looks good to me',
            html_url: 'https://example.com/review/102'
          }
        ]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await findDeferredWorkWithOctokit(context, 42);
  const parsed = JSON.parse(output);

  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 101);
  assert.equal(parsed[0].path, 'src/a.ts');
});

test('checkGeminiQuotaWithOctokit detects quota message', async () => {
  const context = createContext((url) => {
    if (url.includes('/repos/a2f0/tearleads/pulls/42/reviews')) {
      return { status: 200, body: [{ body: 'Looks good' }] };
    }
    if (url.includes('/repos/a2f0/tearleads/pulls/42/comments')) {
      return {
        status: 200,
        body: [
          {
            body: 'You have reached your daily quota limit. Please wait up to 24 hours and I will start processing your requests again!'
          }
        ]
      };
    }
    if (url.includes('/repos/a2f0/tearleads/issues/42/comments')) {
      return { status: 200, body: [{ body: 'Issue comment' }] };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await checkGeminiQuotaWithOctokit(context, 42, undefined);
  const parsed = JSON.parse(output);

  assert.equal(parsed.quota_exhausted, true);
  assert.equal(parsed.match_count, 1);
});
