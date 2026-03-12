import {
  buildAdminV2ConnectMethodPath,
  buildAiV2ConnectMethodPath,
  buildAuthV2ConnectMethodPath,
  buildVfsSharesV2ConnectMethodPath,
  buildVfsV2ConnectMethodPath
} from '@tearleads/shared';
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
    ).toBe(`/v1${buildAuthV2ConnectMethodPath('RefreshToken')}`);

    expect(
      resolveConnectUrlForApiBase(
        'http://localhost/v1/',
        AUTH_V2_LOGIN_CONNECT_PATH
      )
    ).toBe(`http://localhost/v1${buildAuthV2ConnectMethodPath('Login')}`);
  });

  it('builds admin and ai method paths from canonical base paths', () => {
    expect(
      buildConnectMethodPath(ADMIN_V2_CONNECT_BASE_PATH, 'GetRedisDbSize')
    ).toBe(buildAdminV2ConnectMethodPath('GetRedisDbSize'));
    expect(
      buildConnectMethodPath(AI_V2_CONNECT_BASE_PATH, 'GetUsageSummary')
    ).toBe(buildAiV2ConnectMethodPath('GetUsageSummary'));
  });

  it('builds vfs service paths from generated type names', () => {
    expect(
      buildConnectMethodPath(VFS_V2_CONNECT_BASE_PATH, 'PushCrdtOps')
    ).toBe(buildVfsV2ConnectMethodPath('PushCrdtOps'));
    expect(buildConnectMethodPath(VFS_V2_CONNECT_BASE_PATH, 'GetSync')).toBe(
      buildVfsV2ConnectMethodPath('GetSync')
    );
    expect(
      buildConnectMethodPath(VFS_SHARES_V2_CONNECT_BASE_PATH, 'CreateShare')
    ).toBe(buildVfsSharesV2ConnectMethodPath('CreateShare'));
    expect(VFS_V2_PUSH_CRDT_OPS_CONNECT_PATH).toBe(
      buildVfsV2ConnectMethodPath('PushCrdtOps')
    );
  });
});
