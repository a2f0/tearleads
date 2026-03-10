import { describe, expect, it } from 'vitest';
import {
  mergeHeaders,
  resolveDirectApiPath
} from './apiScenarioConnectCompat.js';

describe('resolveDirectApiPath', () => {
  it('keeps /v1-prefixed paths unchanged', () => {
    expect(
      resolveDirectApiPath('/v1/connect/tearleads.v2.VfsService/Register')
    ).toBe('/v1/connect/tearleads.v2.VfsService/Register');
  });

  it('prefixes non-v1 API paths with /v1', () => {
    expect(
      resolveDirectApiPath('/connect/tearleads.v2.VfsService/Register')
    ).toBe('/v1/connect/tearleads.v2.VfsService/Register');
    expect(
      resolveDirectApiPath('/connect/tearleads.v2.AuthService/Login')
    ).toBe('/v1/connect/tearleads.v2.AuthService/Login');
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
