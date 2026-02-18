import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext } from './testOctokitContext.ts';
import {
  createDeferredFixIssueWithOctokit,
  sanitizePrBodyWithOctokit,
  updatePrBodyWithOctokit
} from './utils/octokitPrBodyHandlers.ts';
import { createPrWithOctokit } from './utils/octokitPrOpsHandlers.ts';

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

test('createPrWithOctokit creates a new pull request', async () => {
  const context = createContext(({ url, method }) => {
    if (url.endsWith('/repos/a2f0/tearleads/pulls') && method === 'POST') {
      return {
        status: 201,
        body: {
          number: 123,
          html_url: 'https://example.com/pull/123',
          state: 'open'
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await createPrWithOctokit(context, {
    title: 'feat: example',
    base: 'main',
    head: 'feature/example',
    body: 'PR body'
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'created');
  assert.equal(parsed.number, 123);
});
