import { VfsService } from './gen/tearleads/v2/vfs_pb.js';
import { VfsSharesService } from './gen/tearleads/v2/vfs_shares_pb.js';

export const VFS_V2_SERVICE_NAME = VfsService.typeName;
export const VFS_SHARES_V2_SERVICE_NAME = VfsSharesService.typeName;
export const VFS_V2_CONNECT_BASE_PATH = `/connect/${VFS_V2_SERVICE_NAME}`;
export const VFS_SHARES_V2_CONNECT_BASE_PATH = `/connect/${VFS_SHARES_V2_SERVICE_NAME}`;

export function buildVfsV2ConnectMethodPath(methodName: string): string {
  return `${VFS_V2_CONNECT_BASE_PATH}/${methodName}`;
}

export function buildVfsSharesV2ConnectMethodPath(methodName: string): string {
  return `${VFS_SHARES_V2_CONNECT_BASE_PATH}/${methodName}`;
}

export const VFS_V2_GET_EMAIL_CONNECT_PATH =
  buildVfsV2ConnectMethodPath('GetEmail');
export const VFS_V2_GET_EMAILS_CONNECT_PATH =
  buildVfsV2ConnectMethodPath('GetEmails');
export const VFS_V2_SEND_EMAIL_CONNECT_PATH =
  buildVfsV2ConnectMethodPath('SendEmail');
