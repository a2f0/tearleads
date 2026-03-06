import type { ConnectRouter } from '@connectrpc/connect';
import { AiService } from '@tearleads/shared/gen/tearleads/v1/ai_pb';
import { AuthService } from '@tearleads/shared/gen/tearleads/v1/auth_pb';
import { BillingService } from '@tearleads/shared/gen/tearleads/v1/billing_pb';
import { ChatService } from '@tearleads/shared/gen/tearleads/v1/chat_pb';
import { NotificationService } from '@tearleads/shared/gen/tearleads/v1/notifications_pb';
import { RevenuecatService } from '@tearleads/shared/gen/tearleads/v1/revenuecat_pb';
import { VfsSharesService } from '@tearleads/shared/gen/tearleads/v1/vfs_shares_pb';
import { MlsService as MlsServiceV2 } from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import { VfsService as VfsServiceV2 } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import { aiConnectService } from './services/aiService.js';
import { authConnectService } from './services/authService.js';
import { billingConnectService } from './services/billingService.js';
import { chatConnectService } from './services/chatService.js';
import { mlsConnectServiceV2 } from './services/mlsService.js';
import { notificationConnectService } from './services/notificationService.js';
import { revenuecatConnectService } from './services/revenuecatService.js';
import { vfsConnectService } from './services/vfsService.js';
import { vfsSharesConnectService } from './services/vfsSharesService.js';

export function registerConnectRoutes(router: ConnectRouter): void {
  router.service(AiService, aiConnectService);
  router.service(AuthService, authConnectService);
  router.service(BillingService, billingConnectService);
  router.service(ChatService, chatConnectService);
  router.service(MlsServiceV2, mlsConnectServiceV2);
  router.service(NotificationService, notificationConnectService);
  router.service(RevenuecatService, revenuecatConnectService);
  router.service(VfsServiceV2, vfsConnectService);
  router.service(VfsSharesService, vfsSharesConnectService);
}
