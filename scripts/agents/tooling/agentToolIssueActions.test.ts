import assert from 'node:assert/strict';
import test from 'node:test';
import { Octokit } from '@octokit/rest';
import type { GitHubClientContext } from './utils/githubClient.ts';
import {
  getIssueWithOctokit,
  listDeferredFixIssuesWithOctokit
} from './utils/octokitIssueHandlers.ts';
import { checkGeminiQuotaWithOctokit } from './utils/octokitReviewHandlers.ts';

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
