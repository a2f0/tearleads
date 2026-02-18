import assert from 'node:assert/strict';
import test from 'node:test';
import { Octokit } from '@octokit/rest';
import type { GitHubClientContext } from './utils/githubClient.ts';
import {
  createDeferredFixIssueWithOctokit,
  sanitizePrBodyWithOctokit,
  updatePrBodyWithOctokit
} from './utils/octokitPrBodyHandlers.ts';
import {
  getPrInfoWithOctokit,
  getReviewThreadsWithOctokit,
  triggerGeminiReviewWithOctokit
} from './utils/octokitPrInfoHandlers.ts';
import {
  enableAutoMergeWithOctokit,
  findPrForBranchWithOctokit,
  generatePrSummaryWithOctokit,
  listHighPriorityPrsWithOctokit
} from './utils/octokitPrOpsHandlers.ts';
import { checkMainVersionBumpSetupWithOctokit } from './utils/octokitRepoHandlers.ts';

function toUrlString(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createContext(
  responder: (request: { url: string; method: string; body: unknown }) => {
    status: number;
    body: unknown;
  }
): GitHubClientContext {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = toUrlString(input);
    const method = init?.method ?? 'GET';
    const rawBody =
      typeof init?.body === 'string'
        ? init.body
        : init?.body instanceof Uint8Array
          ? new TextDecoder().decode(init.body)
          : '';
    const parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : null;
    const { status, body } = responder({ url, method, body: parsedBody });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' }
    });
  };

  return {
    octokit: new Octokit({
      auth: 'test-token',
      request: { fetch: mockFetch }
    }),
    owner: 'a2f0',
    repo: 'tearleads'
  };
}

test('checkMainVersionBumpSetupWithOctokit reports missing requirements', async () => {
  const context = createContext(({ url }) => {
    if (url.includes('/repos/a2f0/tearleads/actions/secrets')) {
      return {
        status: 200,
        body: {
          total_count: 1,
          secrets: [{ name: 'MERGE_SIGNING_APP_ID' }]
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await checkMainVersionBumpSetupWithOctokit(context, {
    keyFile: '/tmp/does-not-exist.pem'
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.status, 'missing_requirements');
  assert.match(
    JSON.stringify(parsed.missing),
    /MERGE_SIGNING_APP_PRIVATE_KEY not found/
  );
});

test('getPrInfoWithOctokit returns normalized selected fields', async () => {
  const context = createContext(({ url }) => {
    if (url.includes('/repos/a2f0/tearleads/pulls?')) {
      return {
        status: 200,
        body: [{ number: 55 }]
      };
    }
    if (url.endsWith('/repos/a2f0/tearleads/pulls/55')) {
      return {
        status: 200,
        body: {
          number: 55,
          title: 'Example PR',
          body: 'body',
          state: 'closed',
          merged_at: '2026-02-17T00:00:00Z',
          mergeable_state: 'clean',
          mergeable: true,
          head: { ref: 'feature/x' },
          base: { ref: 'main' },
          html_url: 'https://example.com/pull/55',
          user: { login: 'octocat' },
          labels: []
        }
      };
    }
    if (url.includes('/repos/a2f0/tearleads/pulls/55/files')) {
      return {
        status: 200,
        body: [{ filename: 'src/a.ts' }]
      };
    }
    if (url.includes('/repos/a2f0/tearleads/issues/55/comments')) {
      return {
        status: 200,
        body: [
          {
            id: 9,
            html_url: 'https://example.com/comment/9',
            body: 'comment',
            user: { login: 'gemini-code-assist' }
          }
        ]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getPrInfoWithOctokit(
    context,
    'number,state,mergeStateStatus,comments,files'
  );
  const parsed = JSON.parse(output);

  assert.equal(parsed.number, 55);
  assert.equal(parsed.state, 'MERGED');
  assert.equal(parsed.mergeStateStatus, 'CLEAN');
  assert.equal(parsed.comments.length, 1);
  assert.equal(parsed.files[0].path, 'src/a.ts');
});

test('getReviewThreadsWithOctokit filters unresolved threads', async () => {
  const context = createContext(({ url }) => {
    if (url.endsWith('/graphql')) {
      return {
        status: 200,
        body: {
          data: {
            repository: {
              pullRequest: {
                reviewThreads: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: 'T1',
                      isResolved: true,
                      path: 'src/a.ts',
                      line: 1,
                      comments: {
                        pageInfo: { hasNextPage: false },
                        nodes: []
                      }
                    },
                    {
                      id: 'T2',
                      isResolved: false,
                      path: 'src/b.ts',
                      line: 2,
                      comments: {
                        pageInfo: { hasNextPage: false },
                        nodes: [
                          {
                            id: 'C1',
                            databaseId: 10,
                            author: { login: 'x' },
                            body: 'b'
                          }
                        ]
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getReviewThreadsWithOctokit(context, 42, true);
  const parsed = JSON.parse(output);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0].id, 'T2');
});

test('triggerGeminiReviewWithOctokit can timeout immediately', async () => {
  const requests: string[] = [];
  const context = createContext(({ url }) => {
    requests.push(url);
    if (url.includes('/repos/a2f0/tearleads/issues/42/comments')) {
      return { status: 201, body: { id: 1 } };
    }
    if (url.includes('/repos/a2f0/tearleads/pulls/42/reviews')) {
      return { status: 200, body: [] };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await triggerGeminiReviewWithOctokit(context, 42, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'review_requested');
  assert.ok(
    requests.some((url) =>
      url.includes('/repos/a2f0/tearleads/issues/42/comments')
    )
  );
});

test('enableAutoMergeWithOctokit sends graphql mutation', async () => {
  const context = createContext(({ url }) => {
    if (url.endsWith('/repos/a2f0/tearleads/pulls/77')) {
      return { status: 200, body: { node_id: 'PR_node_77' } };
    }
    if (url.endsWith('/graphql')) {
      return {
        status: 200,
        body: {
          data: { enablePullRequestAutoMerge: { pullRequest: { number: 77 } } }
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await enableAutoMergeWithOctokit(context, 77);
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'auto_merge_enabled');
});

test('findPrForBranchWithOctokit can find merged PR', async () => {
  const context = createContext(({ url }) => {
    if (url.includes('/repos/a2f0/tearleads/pulls?')) {
      return {
        status: 200,
        body: [
          {
            number: 12,
            title: 'Closed',
            state: 'closed',
            merged_at: null,
            html_url: 'x'
          },
          {
            number: 13,
            title: 'Merged',
            state: 'closed',
            merged_at: '2026-02-18T00:00:00Z',
            html_url: 'y'
          }
        ]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await findPrForBranchWithOctokit(context, 'main', 'merged');
  const parsed = JSON.parse(output);
  assert.equal(parsed.number, 13);
  assert.equal(parsed.state, 'MERGED');
});

test('listHighPriorityPrsWithOctokit returns merge statuses', async () => {
  const context = createContext(({ url }) => {
    if (url.includes('/search/issues')) {
      return {
        status: 200,
        body: {
          total_count: 1,
          incomplete_results: false,
          items: [{ number: 90, pull_request: { url: 'x' } }]
        }
      };
    }
    if (url.endsWith('/repos/a2f0/tearleads/pulls/90')) {
      return {
        status: 200,
        body: { number: 90, title: 'HP PR', mergeable_state: 'blocked' }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await listHighPriorityPrsWithOctokit(context);
  const parsed = JSON.parse(output);
  assert.equal(parsed[0].mergeStateStatus, 'BLOCKED');
});

test('generatePrSummaryWithOctokit formats summary', async () => {
  const context = createContext(({ url }) => {
    if (url.endsWith('/repos/a2f0/tearleads/pulls/21')) {
      return {
        status: 200,
        body: {
          number: 21,
          title: 'PR title',
          body: 'line1\nline2',
          state: 'open',
          merged_at: null,
          mergeable_state: 'clean',
          head: { ref: 'feature/y' },
          base: { ref: 'main' },
          html_url: 'https://example.com/pull/21',
          user: { login: 'octocat' }
        }
      };
    }
    if (url.includes('/repos/a2f0/tearleads/pulls/21/files')) {
      return {
        status: 200,
        body: [{ filename: 'src/a.ts' }, { filename: 'src/b.ts' }]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await generatePrSummaryWithOctokit(context, { number: 21 });
  assert.match(output, /PR #21: PR title/);
  assert.match(output, /Files changed \(2\)/);
});

test('sanitizePrBodyWithOctokit removes auto-close directives', async () => {
  let updatedBody = '';
  const context = createContext(({ url, method, body }) => {
    if (url.endsWith('/repos/a2f0/tearleads/pulls/33') && method === 'GET') {
      return {
        status: 200,
        body: { body: 'Hello\n\nFixes #12\nResolves #34' }
      };
    }
    if (url.endsWith('/repos/a2f0/tearleads/pulls/33') && method === 'PATCH') {
      updatedBody =
        typeof body === 'object' && body !== null
          ? String(Reflect.get(body, 'body') ?? '')
          : '';
      return { status: 200, body: {} };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await sanitizePrBodyWithOctokit(context, 33);
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'updated');
  assert.deepEqual(parsed.issue_numbers, [12, 34]);
  assert.doesNotMatch(updatedBody, /Fixes|Resolves/i);
});

test('createDeferredFixIssueWithOctokit creates issue', async () => {
  const context = createContext(({ url, method }) => {
    if (url.endsWith('/repos/a2f0/tearleads/issues') && method === 'POST') {
      return {
        status: 201,
        body: { html_url: 'https://example.com/issues/999' }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await createDeferredFixIssueWithOctokit(context, {
    number: 7,
    prUrl: 'https://example.com/pull/7',
    deferredItemsJson: JSON.stringify([
      {
        body: 'follow up',
        path: 'src/a.ts',
        line: 11,
        html_url: 'https://example.com/thread/1'
      }
    ])
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'created');
  assert.equal(parsed.deferred_item_count, 1);
});

test('updatePrBodyWithOctokit updates using direct body', async () => {
  let bodyLength = 0;
  const context = createContext(({ url, method, body }) => {
    if (url.endsWith('/repos/a2f0/tearleads/pulls/44') && method === 'PATCH') {
      const nextBody =
        typeof body === 'object' && body !== null
          ? String(Reflect.get(body, 'body') ?? '')
          : '';
      bodyLength = nextBody.length;
      return { status: 200, body: {} };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await updatePrBodyWithOctokit(context, {
    number: 44,
    body: '## Summary\n- updated'
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'updated');
  assert.equal(bodyLength, parsed.body_length);
});
