import { createClient } from '@connectrpc/connect';
import { createConnectTransport } from '@connectrpc/connect-web';
import * as adminConnect from '@tearleads/shared/gen/tearleads/v2/admin_connect';
import { AdminService } from '@tearleads/shared/gen/tearleads/v2/admin_pb';
import * as aiConnect from '@tearleads/shared/gen/tearleads/v2/ai_connect';
import { AiService } from '@tearleads/shared/gen/tearleads/v2/ai_pb';
import * as authConnect from '@tearleads/shared/gen/tearleads/v2/auth_connect';
import { AuthService } from '@tearleads/shared/gen/tearleads/v2/auth_pb';
import * as billingConnect from '@tearleads/shared/gen/tearleads/v2/billing_connect';
import { BillingService } from '@tearleads/shared/gen/tearleads/v2/billing_pb';
import * as chatConnect from '@tearleads/shared/gen/tearleads/v2/chat_connect';
import { ChatService } from '@tearleads/shared/gen/tearleads/v2/chat_pb';
import * as mlsConnect from '@tearleads/shared/gen/tearleads/v2/mls_connect';
import { MlsService } from '@tearleads/shared/gen/tearleads/v2/mls_pb';
import * as notificationsConnect from '@tearleads/shared/gen/tearleads/v2/notifications_connect';
import { NotificationService } from '@tearleads/shared/gen/tearleads/v2/notifications_pb';
import * as revenuecatConnect from '@tearleads/shared/gen/tearleads/v2/revenuecat_connect';
import { RevenuecatService } from '@tearleads/shared/gen/tearleads/v2/revenuecat_pb';
import * as vfsConnect from '@tearleads/shared/gen/tearleads/v2/vfs_connect';
import { VfsService } from '@tearleads/shared/gen/tearleads/v2/vfs_pb';
import * as vfsSharesConnect from '@tearleads/shared/gen/tearleads/v2/vfs_shares_connect';
import { VfsSharesService } from '@tearleads/shared/gen/tearleads/v2/vfs_shares_pb';

const transport = createConnectTransport({
  baseUrl: 'https://example.test',
  useBinaryFormat: true
});

const serviceClients = [
  createClient(AdminService, transport),
  createClient(AiService, transport),
  createClient(AuthService, transport),
  createClient(BillingService, transport),
  createClient(ChatService, transport),
  createClient(MlsService, transport),
  createClient(NotificationService, transport),
  createClient(RevenuecatService, transport),
  createClient(VfsService, transport),
  createClient(VfsSharesService, transport)
] as const;

const serviceConnectDescriptors = [
  adminConnect,
  aiConnect,
  authConnect,
  billingConnect,
  chatConnect,
  mlsConnect,
  notificationsConnect,
  revenuecatConnect,
  vfsConnect,
  vfsSharesConnect
] as const;

void serviceClients;
void serviceConnectDescriptors;
