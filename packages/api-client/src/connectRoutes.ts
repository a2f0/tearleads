import { AdminService } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { AiService } from '@tearleads/shared/gen/tearleads/v2/ai_pb';
import { AuthService } from '@tearleads/shared/gen/tearleads/v2/auth_pb';
import { VfsService } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import { VfsSharesService } from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';

function trimTrailingSlash(pathname: string): string {
  return pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

function buildConnectBasePath(serviceTypeName: string): string {
  return `/connect/${serviceTypeName}`;
}

export function buildConnectMethodPath(
  connectBasePath: string,
  methodName: string
): string {
  return `${connectBasePath}/${methodName}`;
}

export function getApiBasePathPrefix(apiBaseUrl: string): string {
  const pathname = trimTrailingSlash(new URL(apiBaseUrl).pathname);
  if (pathname.length === 0 || pathname === '/') {
    return '';
  }
  return pathname;
}

export function resolveConnectPathForApiBase(
  apiBaseUrl: string,
  connectPath: string
): string {
  return `${getApiBasePathPrefix(apiBaseUrl)}${connectPath}`;
}

export function resolveConnectUrlForApiBase(
  apiBaseUrl: string,
  connectPath: string
): string {
  const base = new URL(apiBaseUrl);
  return `${base.origin}${resolveConnectPathForApiBase(apiBaseUrl, connectPath)}`;
}

export const AUTH_V2_CONNECT_BASE_PATH = buildConnectBasePath(
  AuthService.typeName
);
export const AUTH_V2_LOGIN_CONNECT_PATH = buildConnectMethodPath(
  AUTH_V2_CONNECT_BASE_PATH,
  'Login'
);
export const AUTH_V2_REGISTER_CONNECT_PATH = buildConnectMethodPath(
  AUTH_V2_CONNECT_BASE_PATH,
  'Register'
);
export const AUTH_V2_REFRESH_CONNECT_PATH = buildConnectMethodPath(
  AUTH_V2_CONNECT_BASE_PATH,
  'RefreshToken'
);
export const AUTH_V2_GET_SESSIONS_CONNECT_PATH = buildConnectMethodPath(
  AUTH_V2_CONNECT_BASE_PATH,
  'GetSessions'
);
export const AUTH_V2_LOGOUT_CONNECT_PATH = buildConnectMethodPath(
  AUTH_V2_CONNECT_BASE_PATH,
  'Logout'
);
export const AUTH_V2_GET_ORGANIZATIONS_CONNECT_PATH = buildConnectMethodPath(
  AUTH_V2_CONNECT_BASE_PATH,
  'GetOrganizations'
);

export const ADMIN_V2_CONNECT_BASE_PATH = buildConnectBasePath(
  AdminService.typeName
);
export const AI_V2_CONNECT_BASE_PATH = buildConnectBasePath(AiService.typeName);
export const VFS_V2_SERVICE_NAME = VfsService.typeName;
export const VFS_SHARES_V2_SERVICE_NAME = VfsSharesService.typeName;
export const VFS_V2_CONNECT_BASE_PATH =
  buildConnectBasePath(VFS_V2_SERVICE_NAME);
export const VFS_SHARES_V2_CONNECT_BASE_PATH = buildConnectBasePath(
  VFS_SHARES_V2_SERVICE_NAME
);
export const VFS_V2_PUSH_CRDT_OPS_CONNECT_PATH = buildConnectMethodPath(
  VFS_V2_CONNECT_BASE_PATH,
  'PushCrdtOps'
);
