import { AdminService } from './gen/tearleads/v2/admin_pb.js';
import { AiService } from './gen/tearleads/v2/ai_pb.js';
import { AuthService } from './gen/tearleads/v2/auth_pb.js';
import { MlsService } from './gen/tearleads/v2/mls_pb.js';
import { VfsService } from './gen/tearleads/v2/vfs_pb.js';
import { VfsSharesService } from './gen/tearleads/v2/vfs_shares_pb.js';

export const ADMIN_V2_SERVICE_NAME = AdminService.typeName;
export const AI_V2_SERVICE_NAME = AiService.typeName;
export const AUTH_V2_SERVICE_NAME = AuthService.typeName;
export const MLS_V2_SERVICE_NAME = MlsService.typeName;
export const VFS_V2_SERVICE_NAME = VfsService.typeName;
export const VFS_SHARES_V2_SERVICE_NAME = VfsSharesService.typeName;
export const ADMIN_V2_CONNECT_BASE_PATH = `/connect/${ADMIN_V2_SERVICE_NAME}`;
export const AI_V2_CONNECT_BASE_PATH = `/connect/${AI_V2_SERVICE_NAME}`;
export const AUTH_V2_CONNECT_BASE_PATH = `/connect/${AUTH_V2_SERVICE_NAME}`;
export const MLS_V2_CONNECT_BASE_PATH = `/connect/${MLS_V2_SERVICE_NAME}`;
export const VFS_V2_CONNECT_BASE_PATH = `/connect/${VFS_V2_SERVICE_NAME}`;
export const VFS_SHARES_V2_CONNECT_BASE_PATH = `/connect/${VFS_SHARES_V2_SERVICE_NAME}`;

export function buildAdminV2ConnectMethodPath(methodName: string): string {
  return `${ADMIN_V2_CONNECT_BASE_PATH}/${methodName}`;
}

export function buildAiV2ConnectMethodPath(methodName: string): string {
  return `${AI_V2_CONNECT_BASE_PATH}/${methodName}`;
}

export function buildAuthV2ConnectMethodPath(methodName: string): string {
  return `${AUTH_V2_CONNECT_BASE_PATH}/${methodName}`;
}

export function buildMlsV2ConnectMethodPath(methodName: string): string {
  return `${MLS_V2_CONNECT_BASE_PATH}/${methodName}`;
}

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
