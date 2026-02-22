import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext } from './testOctokitContext.ts';
import {
  getPrChecksWithOctokit,
  getRequiredChecksStatusWithOctokit
} from './utils/octokitPrChecksHandlers.ts';
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
import {
  checkMainVersionBumpSetupWithOctokit,
  getDefaultBranchWithOctokit
} from './utils/octokitRepoHandlers.ts';

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

test('getDefaultBranchWithOctokit returns default branch', async () => {
  const context = createContext(({ url }) => {
    if (url.endsWith('/repos/a2f0/tearleads')) {
      return { status: 200, body: { default_branch: 'main' } };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getDefaultBranchWithOctokit(context);
  const parsed = JSON.parse(output);
  assert.equal(parsed.default_branch, 'main');
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

test('getPrChecksWithOctokit returns check runs and status contexts', async () => {
  const context = createContext(({ url }) => {
    if (url.endsWith('/repos/a2f0/tearleads/pulls/55')) {
      return {
        status: 200,
        body: {
          head: { sha: 'abc123' }
        }
      };
    }
    if (url.includes('/repos/a2f0/tearleads/commits/abc123/check-runs')) {
      return {
        status: 200,
        body: {
          total_count: 1,
          check_runs: [
            {
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              details_url: 'https://example.com/check/1'
            }
          ]
        }
      };
    }
    if (url.includes('/repos/a2f0/tearleads/commits/abc123/status')) {
      return {
        status: 200,
        body: {
          state: 'success',
          statuses: [
            {
              context: 'legacy-status',
              state: 'success',
              target_url: 'https://example.com/status/1'
            }
          ]
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getPrChecksWithOctokit(context, 55);
  const parsed = JSON.parse(output);
  assert.equal(parsed.total, 2);
  assert.equal(parsed.checks[0].name, 'build');
});

test('getRequiredChecksStatusWithOctokit evaluates required contexts', async () => {
  const context = createContext(({ url }) => {
    if (url.endsWith('/repos/a2f0/tearleads/pulls/55')) {
      return {
        status: 200,
        body: {
          head: { sha: 'abc123' },
          base: { ref: 'main' }
        }
      };
    }
    if (url.includes('/repos/a2f0/tearleads/commits/abc123/check-runs')) {
      return {
        status: 200,
        body: {
          total_count: 1,
          check_runs: [
            {
              name: 'build',
              status: 'completed',
              conclusion: 'success',
              details_url: 'https://example.com/check/1'
            }
          ]
        }
      };
    }
    if (url.includes('/repos/a2f0/tearleads/commits/abc123/status')) {
      return {
        status: 200,
        body: {
          state: 'success',
          statuses: []
        }
      };
    }
    if (url.endsWith('/repos/a2f0/tearleads/branches/main/protection')) {
      return {
        status: 200,
        body: {
          required_status_checks: {
            contexts: ['build']
          }
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getRequiredChecksStatusWithOctokit(context, 55);
  const parsed = JSON.parse(output);
  assert.equal(parsed.required_check_count, 1);
  assert.equal(parsed.all_passed, true);
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
                            fullDatabaseId: '10',
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
  assert.equal(parsed[0].comments[0].databaseId, '10');
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
