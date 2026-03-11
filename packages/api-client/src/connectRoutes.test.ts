import { describe, expect, it } from 'vitest';
import {
  ADMIN_V2_CONNECT_BASE_PATH,
  AI_V2_CONNECT_BASE_PATH,
  AUTH_V2_LOGIN_CONNECT_PATH,
  AUTH_V2_REFRESH_CONNECT_PATH,
  buildConnectMethodPath,
  getApiBasePathPrefix,
  resolveConnectPathForApiBase,
  resolveConnectUrlForApiBase,
  VFS_SHARES_V2_CONNECT_BASE_PATH,
  VFS_V2_CONNECT_BASE_PATH,
  VFS_V2_PUSH_CRDT_OPS_CONNECT_PATH
} from './connectRoutes';

describe('connectRoutes', () => {
  it('normalizes API base URL path prefixes', () => {
    expect(getApiBasePathPrefix('http://localhost')).toBe('');
    expect(getApiBasePathPrefix('http://localhost/')).toBe('');
    expect(getApiBasePathPrefix('http://localhost/v1')).toBe('/v1');
    expect(getApiBasePathPrefix('http://localhost/v1/')).toBe('/v1');
  });

  it('resolves expected connect paths and urls for base variants', () => {
    expect(
      resolveConnectPathForApiBase(
        'http://localhost/v1/',
        AUTH_V2_REFRESH_CONNECT_PATH
      )
    ).toBe('/v1/connect/tearleads.v2.AuthService/RefreshToken');

    expect(
      resolveConnectUrlForApiBase(
        'http://localhost/v1/',
        AUTH_V2_LOGIN_CONNECT_PATH
      )
    ).toBe('http://localhost/v1/connect/tearleads.v2.AuthService/Login');
  });

  it('builds admin and ai method paths from canonical base paths', () => {
    expect(
      buildConnectMethodPath(ADMIN_V2_CONNECT_BASE_PATH, 'GetRedisDbSize')
    ).toBe('/connect/tearleads.v2.AdminService/GetRedisDbSize');
    expect(
      buildConnectMethodPath(AI_V2_CONNECT_BASE_PATH, 'GetUsageSummary')
    ).toBe('/connect/tearleads.v2.AiService/GetUsageSummary');
  });

  it('builds vfs service paths from generated type names', () => {
    expect(VFS_V2_CONNECT_BASE_PATH).toBe('/connect/tearleads.v2.VfsService');
    expect(VFS_SHARES_V2_CONNECT_BASE_PATH).toBe(
      '/connect/tearleads.v2.VfsSharesService'
    );
    expect(VFS_V2_PUSH_CRDT_OPS_CONNECT_PATH).toBe(
      '/connect/tearleads.v2.VfsService/PushCrdtOps'
    );
  });
});
