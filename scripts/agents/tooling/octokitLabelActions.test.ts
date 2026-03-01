import assert from 'node:assert/strict';
import test from 'node:test';
import { createContext } from './testOctokitContext.ts';
import { tagPrWithReviewerWithOctokit } from './utils/octokitLabelHandlers.ts';

test('tagPrWithReviewer adds reviewed:gemini label', async () => {
  let labelAdded = false;
  const context = createContext(({ url, method }) => {
    if (url.endsWith('/repos/a2f0/tearleads/issues/42') && method === 'GET') {
      const labels = labelAdded ? [{ name: 'reviewed:gemini' }] : [];
      return {
        status: 200,
        body: { number: 42, labels }
      };
    }
    if (
      url.endsWith('/repos/a2f0/tearleads/labels/reviewed%3Agemini') &&
      method === 'GET'
    ) {
      return {
        status: 200,
        body: { name: 'reviewed:gemini' }
      };
    }
    if (
      url.endsWith('/repos/a2f0/tearleads/issues/42/labels') &&
      method === 'POST'
    ) {
      labelAdded = true;
      return {
        status: 200,
        body: [{ name: 'reviewed:gemini' }]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await tagPrWithReviewerWithOctokit(context, {
    reviewer: 'gemini',
    pr: 42
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'tagged');
  assert.equal(parsed.label, 'reviewed:gemini');
  assert.equal(parsed.pr, 42);
});

test('tagPrWithReviewer returns already_present when label exists', async () => {
  const context = createContext(({ url, method }) => {
    if (url.endsWith('/repos/a2f0/tearleads/issues/42') && method === 'GET') {
      return {
        status: 200,
        body: { number: 42, labels: [{ name: 'reviewed:claude' }] }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await tagPrWithReviewerWithOctokit(context, {
    reviewer: 'claude',
    pr: 42
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'already_present');
  assert.equal(parsed.label, 'reviewed:claude');
});

test('tagPrWithReviewer creates label when it does not exist', async () => {
  let labelCreated = false;
  const context = createContext(({ url, method }) => {
    if (url.endsWith('/repos/a2f0/tearleads/issues/10') && method === 'GET') {
      const labels = labelCreated ? [{ name: 'reviewed:codex' }] : [];
      return {
        status: 200,
        body: { number: 10, labels }
      };
    }
    if (
      url.endsWith('/repos/a2f0/tearleads/labels/reviewed%3Acodex') &&
      method === 'GET'
    ) {
      return { status: 404, body: { message: 'not found' } };
    }
    if (url.endsWith('/repos/a2f0/tearleads/labels') && method === 'POST') {
      labelCreated = true;
      return {
        status: 201,
        body: { name: 'reviewed:codex', color: '0E8A16' }
      };
    }
    if (
      url.endsWith('/repos/a2f0/tearleads/issues/10/labels') &&
      method === 'POST'
    ) {
      labelCreated = true;
      return {
        status: 200,
        body: [{ name: 'reviewed:codex' }]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await tagPrWithReviewerWithOctokit(context, {
    reviewer: 'codex',
    pr: 10
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'tagged');
  assert.equal(parsed.label, 'reviewed:codex');
  assert.ok(labelCreated);
});

test('tagPrWithReviewer rejects invalid reviewer names', async () => {
  const context = createContext(() => ({
    status: 200,
    body: {}
  }));

  await assert.rejects(
    () =>
      tagPrWithReviewerWithOctokit(context, {
        reviewer: 'invalid-agent',
        pr: 1
      }),
    (err: Error) => {
      assert.match(err.message, /Invalid --reviewer/);
      assert.match(err.message, /gemini, claude, codex, opencode/);
      return true;
    }
  );
});

test('tagPrWithReviewer preserves existing reviewed labels', async () => {
  const addedLabels: string[] = [];
  const context = createContext(({ url, method, body }) => {
    if (url.endsWith('/repos/a2f0/tearleads/issues/42') && method === 'GET') {
      return {
        status: 200,
        body: {
          number: 42,
          labels: [
            { name: 'reviewed:gemini' },
            { name: 'reviewed:claude' },
            ...addedLabels.map((n) => ({ name: n }))
          ]
        }
      };
    }
    if (
      url.endsWith('/repos/a2f0/tearleads/labels/reviewed%3Acodex') &&
      method === 'GET'
    ) {
      return {
        status: 200,
        body: { name: 'reviewed:codex' }
      };
    }
    if (
      url.endsWith('/repos/a2f0/tearleads/issues/42/labels') &&
      method === 'POST'
    ) {
      const reqBody = body as { labels?: string[] };
      if (reqBody.labels) {
        addedLabels.push(...reqBody.labels);
      }
      return {
        status: 200,
        body: [{ name: 'reviewed:codex' }]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await tagPrWithReviewerWithOctokit(context, {
    reviewer: 'codex',
    pr: 42
  });
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'tagged');
  assert.equal(parsed.label, 'reviewed:codex');
  assert.deepEqual(addedLabels, ['reviewed:codex']);
});
