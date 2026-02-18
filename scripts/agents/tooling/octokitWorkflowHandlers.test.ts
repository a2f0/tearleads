import assert from 'node:assert/strict';
import test from 'node:test';
import { Octokit } from '@octokit/rest';
import type { GitHubClientContext } from './utils/githubClient.ts';
import {
  cancelWorkflowWithOctokit,
  getCiStatusWithOctokit,
  rerunWorkflowWithOctokit
} from './utils/octokitWorkflowHandlers.ts';

function toUrlString(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

function createContext(
  responder: (request: { url: string; method: string }) => {
    status: number;
    body: unknown;
  }
): GitHubClientContext {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = toUrlString(input);
    const method = init?.method ?? 'GET';
    const { status, body } = responder({ url, method });
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

test('getCiStatusWithOctokit returns run status by run id', async () => {
  const context = createContext(({ url }) => {
    if (url.endsWith('/repos/a2f0/tearleads/actions/runs/123')) {
      return {
        status: 200,
        body: { status: 'completed', conclusion: 'success' }
      };
    }
    if (url.includes('/repos/a2f0/tearleads/actions/runs/123/jobs')) {
      return {
        status: 200,
        body: {
          total_count: 1,
          jobs: [{ name: 'lint', status: 'completed', conclusion: 'success' }]
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getCiStatusWithOctokit(context, '123', undefined);
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'completed');
  assert.equal(parsed.jobs[0].name, 'lint');
});

test('getCiStatusWithOctokit returns run status by commit', async () => {
  const context = createContext(({ url }) => {
    if (
      url.includes('/repos/a2f0/tearleads/actions/runs?') &&
      url.includes('head_sha=abc123')
    ) {
      return {
        status: 200,
        body: {
          total_count: 1,
          workflow_runs: [{ id: 456, status: 'in_progress', conclusion: null }]
        }
      };
    }
    if (url.includes('/repos/a2f0/tearleads/actions/runs/456/jobs')) {
      return {
        status: 200,
        body: {
          total_count: 1,
          jobs: [{ name: 'test', status: 'queued', conclusion: null }]
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getCiStatusWithOctokit(context, undefined, 'abc123');
  const parsed = JSON.parse(output);
  assert.equal(parsed.run_id, 456);
  assert.equal(parsed.status, 'in_progress');
});

test('cancelWorkflowWithOctokit and rerunWorkflowWithOctokit', async () => {
  const context = createContext(({ url, method }) => {
    if (
      method === 'POST' &&
      (url.endsWith('/repos/a2f0/tearleads/actions/runs/789/cancel') ||
        url.endsWith('/repos/a2f0/tearleads/actions/runs/789/rerun'))
    ) {
      return { status: 202, body: {} };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const cancelOutput = await cancelWorkflowWithOctokit(context, '789');
  const rerunOutput = await rerunWorkflowWithOctokit(context, '789');
  assert.equal(JSON.parse(cancelOutput).status, 'cancelled');
  assert.equal(JSON.parse(rerunOutput).status, 'rerun_triggered');
});
