import assert from 'node:assert/strict';
import test from 'node:test';
import { Octokit } from '@octokit/rest';
import type { GitHubClientContext } from './utils/githubClient.ts';
import {
  getCodeScanningAlertWithOctokit,
  listCodeScanningAlertsWithOctokit,
  updateCodeScanningAlertWithOctokit
} from './utils/octokitCodeScanningHandlers.ts';
import {
  getSecretScanningAlertWithOctokit,
  listSecretScanningAlertsWithOctokit,
  updateSecretScanningAlertWithOctokit
} from './utils/octokitSecretScanningHandlers.ts';

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

function buildCodeScanningAlert(number: number): Record<string, unknown> {
  return {
    number,
    state: 'open',
    rule: {
      id: 'js/missing-rate-limit',
      severity: 'error',
      security_severity_level: 'high',
      description: 'Route is missing rate limiting'
    },
    tool: {
      name: 'CodeQL',
      guid: 'codeql',
      version: '2.20.1'
    },
    most_recent_instance: {
      ref: 'refs/heads/main',
      state: 'open',
      analysis_key: 'javascript',
      category: '/language:javascript',
      location: {
        path: 'packages/api/src/index.ts',
        start_line: 140,
        end_line: 140
      }
    },
    html_url: `https://github.com/a2f0/tearleads/security/code-scanning/${number}`,
    created_at: '2026-03-02T15:42:53Z',
    updated_at: '2026-03-02T15:42:53Z',
    dismissed_at: null,
    dismissed_by: null,
    dismissed_reason: null,
    dismissed_comment: null,
    fixed_at: null
  };
}

function buildSecretScanningAlert(number: number): Record<string, unknown> {
  return {
    number,
    state: 'open',
    secret_type: 'github_personal_access_token',
    secret_type_display_name: 'GitHub personal access token',
    resolution: null,
    resolution_comment: null,
    resolved_at: null,
    resolved_by: null,
    html_url: `https://github.com/a2f0/tearleads/security/secret-scanning/${number}`,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    push_protection_bypassed: false,
    push_protection_bypassed_by: null
  };
}

test('listCodeScanningAlertsWithOctokit returns normalized alerts', async () => {
  const context = createContext((url) => {
    if (url.includes('/repos/a2f0/tearleads/code-scanning/alerts')) {
      return {
        status: 200,
        body: [buildCodeScanningAlert(117)]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await listCodeScanningAlertsWithOctokit(context, {
    state: 'open',
    toolName: 'CodeQL'
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.total, 1);
  assert.equal(parsed.alerts[0].number, 117);
  assert.equal(parsed.alerts[0].tool.name, 'CodeQL');
});

test('getCodeScanningAlertWithOctokit returns normalized alert', async () => {
  const context = createContext((url) => {
    if (url.endsWith('/repos/a2f0/tearleads/code-scanning/alerts/118')) {
      return {
        status: 200,
        body: buildCodeScanningAlert(118)
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getCodeScanningAlertWithOctokit(context, 118);
  const parsed = JSON.parse(output);

  assert.equal(parsed.number, 118);
  assert.equal(parsed.state, 'open');
  assert.equal(parsed.rule.id, 'js/missing-rate-limit');
});

test('updateCodeScanningAlertWithOctokit sends dismiss payload', async () => {
  const context = createContext((url, method) => {
    if (
      method === 'PATCH' &&
      url.endsWith('/repos/a2f0/tearleads/code-scanning/alerts/117')
    ) {
      return {
        status: 200,
        body: {
          ...buildCodeScanningAlert(117),
          state: 'dismissed',
          dismissed_reason: 'false positive',
          dismissed_comment: 'Validated as unreachable',
          dismissed_at: '2026-03-02T16:00:00Z'
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await updateCodeScanningAlertWithOctokit(context, {
    alertNumber: 117,
    state: 'dismissed',
    dismissedReason: 'false_positive',
    dismissedComment: 'Validated as unreachable'
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.state, 'dismissed');
  assert.equal(parsed.dismissed_reason, 'false positive');
});

test('listSecretScanningAlertsWithOctokit returns normalized alerts', async () => {
  const context = createContext((url) => {
    if (url.includes('/repos/a2f0/tearleads/secret-scanning/alerts')) {
      return {
        status: 200,
        body: [buildSecretScanningAlert(22)]
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await listSecretScanningAlertsWithOctokit(context, {
    state: 'open'
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.total, 1);
  assert.equal(parsed.alerts[0].number, 22);
  assert.equal(parsed.alerts[0].secret_type, 'github_personal_access_token');
});

test('getSecretScanningAlertWithOctokit returns normalized alert', async () => {
  const context = createContext((url) => {
    if (url.endsWith('/repos/a2f0/tearleads/secret-scanning/alerts/22')) {
      return {
        status: 200,
        body: buildSecretScanningAlert(22)
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await getSecretScanningAlertWithOctokit(context, 22);
  const parsed = JSON.parse(output);

  assert.equal(parsed.number, 22);
  assert.equal(parsed.state, 'open');
});

test('updateSecretScanningAlertWithOctokit sends resolved payload', async () => {
  const context = createContext((url, method) => {
    if (
      method === 'PATCH' &&
      url.endsWith('/repos/a2f0/tearleads/secret-scanning/alerts/22')
    ) {
      return {
        status: 200,
        body: {
          ...buildSecretScanningAlert(22),
          state: 'resolved',
          resolution: 'revoked',
          resolution_comment: 'Token revoked and rotated',
          resolved_at: '2026-03-02T16:05:00Z'
        }
      };
    }
    return { status: 404, body: { message: 'not found' } };
  });

  const output = await updateSecretScanningAlertWithOctokit(context, {
    alertNumber: 22,
    state: 'resolved',
    resolution: 'revoked',
    resolutionComment: 'Token revoked and rotated'
  });
  const parsed = JSON.parse(output);

  assert.equal(parsed.state, 'resolved');
  assert.equal(parsed.resolution, 'revoked');
});
