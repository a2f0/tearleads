import { describe, expect, it } from 'vitest';
import {
  buildVfsSharesV2ConnectMethodPath,
  buildVfsV2ConnectMethodPath,
  VFS_SHARES_V2_CONNECT_BASE_PATH,
  VFS_V2_CONNECT_BASE_PATH,
  VFS_V2_GET_EMAIL_CONNECT_PATH,
  VFS_V2_GET_EMAILS_CONNECT_PATH,
  VFS_V2_SEND_EMAIL_CONNECT_PATH
} from './vfsConnectPaths.js';

describe('vfsConnectPaths', () => {
  it('builds vfs service paths from generated service names', () => {
    expect(VFS_V2_CONNECT_BASE_PATH).toBe('/connect/tearleads.v2.VfsService');
    expect(VFS_SHARES_V2_CONNECT_BASE_PATH).toBe(
      '/connect/tearleads.v2.VfsSharesService'
    );
  });

  it('builds method paths for vfs and share services', () => {
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
