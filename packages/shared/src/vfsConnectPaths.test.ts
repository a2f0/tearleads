import { describe, expect, it } from 'vitest';
import {
  ADMIN_V2_CONNECT_BASE_PATH,
  AI_V2_CONNECT_BASE_PATH,
  AUTH_V2_CONNECT_BASE_PATH,
  buildAdminV2ConnectMethodPath,
  buildAiV2ConnectMethodPath,
  buildAuthV2ConnectMethodPath,
  buildMlsV2ConnectMethodPath,
  buildVfsSharesV2ConnectMethodPath,
  buildVfsV2ConnectMethodPath,
  MLS_V2_CONNECT_BASE_PATH,
  VFS_SHARES_V2_CONNECT_BASE_PATH,
  VFS_V2_CONNECT_BASE_PATH,
  VFS_V2_GET_EMAIL_CONNECT_PATH,
  VFS_V2_GET_EMAILS_CONNECT_PATH,
  VFS_V2_SEND_EMAIL_CONNECT_PATH
} from './vfsConnectPaths.js';

describe('vfsConnectPaths', () => {
  it('builds service base paths from generated service names', () => {
    expect(ADMIN_V2_CONNECT_BASE_PATH).toBe(
      '/connect/tearleads.v2.AdminService'
    );
    expect(AI_V2_CONNECT_BASE_PATH).toBe('/connect/tearleads.v2.AiService');
    expect(AUTH_V2_CONNECT_BASE_PATH).toBe('/connect/tearleads.v2.AuthService');
    expect(MLS_V2_CONNECT_BASE_PATH).toBe('/connect/tearleads.v2.MlsService');
    expect(VFS_V2_CONNECT_BASE_PATH).toBe('/connect/tearleads.v2.VfsService');
    expect(VFS_SHARES_V2_CONNECT_BASE_PATH).toBe(
      '/connect/tearleads.v2.VfsSharesService'
    );
  });

  it('builds method paths for all shared v2 services', () => {
    expect(buildAdminV2ConnectMethodPath('GetContext')).toBe(
      '/connect/tearleads.v2.AdminService/GetContext'
    );
    expect(buildAiV2ConnectMethodPath('GetUsage')).toBe(
      '/connect/tearleads.v2.AiService/GetUsage'
    );
    expect(buildAuthV2ConnectMethodPath('Login')).toBe(
      '/connect/tearleads.v2.AuthService/Login'
    );
    expect(buildMlsV2ConnectMethodPath('ListGroups')).toBe(
      '/connect/tearleads.v2.MlsService/ListGroups'
    );
    expect(buildVfsV2ConnectMethodPath('GetSync')).toBe(
      '/connect/tearleads.v2.VfsService/GetSync'
    );
    expect(buildVfsSharesV2ConnectMethodPath('CreateShare')).toBe(
      '/connect/tearleads.v2.VfsSharesService/CreateShare'
    );
  });

  it('exports legacy email path helpers from the shared builder', () => {
    expect(VFS_V2_GET_EMAIL_CONNECT_PATH).toBe(
      '/connect/tearleads.v2.VfsService/GetEmail'
    );
    expect(VFS_V2_GET_EMAILS_CONNECT_PATH).toBe(
      '/connect/tearleads.v2.VfsService/GetEmails'
    );
    expect(VFS_V2_SEND_EMAIL_CONNECT_PATH).toBe(
      '/connect/tearleads.v2.VfsService/SendEmail'
    );
  });
});
