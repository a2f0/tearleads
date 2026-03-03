import { describe, expect, it } from 'vitest';
import {
  buildRequestQuery,
  findRoute,
  isRouteErrorBodyRecord,
  parseJsonBody
} from './legacyRouteProxyRouting.js';

describe('legacyRouteProxyRouting', () => {
  it('finds routes and decodes path params', () => {
    const groupRouteMatch = findRoute('GET', '/mls/groups/group%2F1');
    expect(groupRouteMatch).not.toBeNull();
    if (!groupRouteMatch) {
      throw new Error('Expected mls group route to match');
    }

    expect(groupRouteMatch.params).toEqual({ groupId: 'group/1' });

    const registerRouteMatch = findRoute('POST', '/vfs/register');
    expect(registerRouteMatch).not.toBeNull();

    const crdtSyncRouteMatch = findRoute('GET', '/vfs/crdt/vfs-sync');
    expect(crdtSyncRouteMatch).not.toBeNull();
  });

  it('returns null for method/path combinations that do not match', () => {
    expect(findRoute('POST', '/mls/groups/group-1')).toBeNull();
    expect(findRoute('GET', '/no/such/route')).toBeNull();
    expect(findRoute('GET', '/mls/groups//members')).toBeNull();
    expect(findRoute('GET', '/mls/groups/%E0%A4%A')).toBeNull();
  });

  it('builds request query objects with repeated keys', () => {
    const params = new URLSearchParams(
      'cursor=c-1&type=user&type=group&type=device'
    );

    expect(buildRequestQuery(params)).toEqual({
      cursor: 'c-1',
      type: ['user', 'group', 'device']
    });

    expect(buildRequestQuery(undefined)).toEqual({});
  });

  it('parses json bodies and rejects malformed json', () => {
    expect(parseJsonBody(undefined)).toEqual({ ok: true, value: {} });
    expect(parseJsonBody('')).toEqual({ ok: true, value: {} });
    expect(parseJsonBody(' {"a":1} ')).toEqual({
      ok: true,
      value: { a: 1 }
    });
    expect(parseJsonBody('{')).toEqual({
      ok: false,
      error: 'Invalid JSON payload'
    });
  });

  it('identifies record-shaped error payloads', () => {
    expect(isRouteErrorBodyRecord({ error: 'x' })).toBe(true);
    expect(isRouteErrorBodyRecord([])).toBe(false);
    expect(isRouteErrorBodyRecord(null)).toBe(false);
    expect(isRouteErrorBodyRecord('x')).toBe(false);
  });

  it('normalizes repeated leading/trailing slashes for route lookups', () => {
    const routeMatch = findRoute('GET', '/vfs/keys/me/');
    expect(routeMatch).not.toBeNull();
  });
});
