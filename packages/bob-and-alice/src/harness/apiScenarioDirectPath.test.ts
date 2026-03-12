import {
  buildAuthV2ConnectMethodPath,
  buildVfsV2ConnectMethodPath
} from '@tearleads/shared';
import { describe, expect, it } from 'vitest';
import { mergeHeaders, resolveDirectApiPath } from './apiScenarioDirectPath.js';

describe('resolveDirectApiPath', () => {
  it('keeps /v1-prefixed paths unchanged', () => {
    const registerPath = buildVfsV2ConnectMethodPath('Register');
    expect(resolveDirectApiPath(`/v1${registerPath}`)).toBe(
      `/v1${registerPath}`
    );
  });

  it('prefixes non-v1 API paths with /v1', () => {
    const registerPath = buildVfsV2ConnectMethodPath('Register');
    const loginPath = buildAuthV2ConnectMethodPath('Login');
    expect(resolveDirectApiPath(registerPath)).toBe(`/v1${registerPath}`);
    expect(resolveDirectApiPath(loginPath)).toBe(`/v1${loginPath}`);
  });
});

describe('mergeHeaders', () => {
  it('sets auth and organization headers', () => {
    const headers = mergeHeaders('token-1', undefined, 'org-1');
    expect(headers.get('Authorization')).toBe('Bearer token-1');
    expect(headers.get('X-Organization-Id')).toBe('org-1');
  });

  it('merges extra headers and allows overrides', () => {
    const headers = mergeHeaders(
      'token-1',
      {
        'X-Test-Header': 'value-1',
        Authorization: 'Bearer override-token'
      },
      'org-1'
    );

    expect(headers.get('X-Test-Header')).toBe('value-1');
    expect(headers.get('Authorization')).toBe('Bearer override-token');
    expect(headers.get('X-Organization-Id')).toBe('org-1');
  });
});
