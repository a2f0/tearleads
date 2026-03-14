import type { ConnectRouter } from '@connectrpc/connect';
import { AdminService as AdminServiceV2 } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import { AiService as AiServiceV2 } from '@tearleads/shared/gen/tearleads/v2/ai_pb';
import { AuthService } from '@tearleads/shared/gen/tearleads/v2/auth_pb';
import { BillingService } from '@tearleads/shared/gen/tearleads/v2/billing_pb';
import { ChatService } from '@tearleads/shared/gen/tearleads/v2/chat_pb';
import { MlsService as MlsServiceV2 } from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import { NotificationService } from '@tearleads/shared/gen/tearleads/v2/notifications_pb';
import { RevenuecatService } from '@tearleads/shared/gen/tearleads/v2/revenuecat_pb';
import { VfsService as VfsServiceV2 } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import { VfsSharesService as VfsSharesServiceV2 } from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';
import { adminConnectServiceV2 } from './services/adminServiceV2.js';
import { aiConnectServiceV2 } from './services/aiServiceV2.js';
import { authConnectService } from './services/authService.js';
import { billingConnectService } from './services/billingService.js';
import { chatConnectService } from './services/chatService.js';
import { mlsConnectServiceV2 } from './services/mlsService.js';
import { notificationConnectService } from './services/notificationService.js';
import { revenuecatConnectService } from './services/revenuecatService.js';
import { vfsConnectRouterService } from './services/vfsService.js';
import { vfsSharesConnectRouterService } from './services/vfsSharesService.js';

export function registerConnectRoutes(router: ConnectRouter): void {
  router.service(AdminServiceV2, adminConnectServiceV2);
  router.service(AiServiceV2, aiConnectServiceV2);
  router.service(AuthService, authConnectService);
  router.service(BillingService, billingConnectService);
  router.service(ChatService, chatConnectService);
  router.service(MlsServiceV2, mlsConnectServiceV2);
  router.service(NotificationService, notificationConnectService);
  router.service(RevenuecatService, revenuecatConnectService);
  router.service(VfsServiceV2, vfsConnectRouterService);
  router.service(VfsSharesServiceV2, vfsSharesConnectRouterService);
}
