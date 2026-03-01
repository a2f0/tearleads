import type { ConnectRouter } from '@connectrpc/connect';
import { AdminService } from '@tearleads/shared/gen/tearleads/v1/admin_connect';
import { AiService } from '@tearleads/shared/gen/tearleads/v1/ai_connect';
import { AuthService } from '@tearleads/shared/gen/tearleads/v1/auth_connect';
import { BillingService } from '@tearleads/shared/gen/tearleads/v1/billing_connect';
import { ChatService } from '@tearleads/shared/gen/tearleads/v1/chat_connect';
import { MlsService } from '@tearleads/shared/gen/tearleads/v1/mls_connect';
import { VfsService } from '@tearleads/shared/gen/tearleads/v1/vfs_connect';
import { VfsSharesService } from '@tearleads/shared/gen/tearleads/v1/vfs_shares_connect';
import { adminConnectService } from './services/adminService.js';
import { aiConnectService } from './services/aiService.js';
import { authConnectService } from './services/authService.js';
import { billingConnectService } from './services/billingService.js';
import { chatConnectService } from './services/chatService.js';
import { mlsConnectService } from './services/mlsService.js';
import { vfsConnectService } from './services/vfsService.js';
import { vfsSharesConnectService } from './services/vfsSharesService.js';

export function registerConnectRoutes(router: ConnectRouter): void {
  router.service(AuthService, authConnectService);
  router.service(VfsService, vfsConnectService);
  router.service(VfsSharesService, vfsSharesConnectService);
  router.service(MlsService, mlsConnectService);
  router.service(AdminService, adminConnectService);
  router.service(BillingService, billingConnectService);
  router.service(AiService, aiConnectService);
  router.service(ChatService, chatConnectService);
}
