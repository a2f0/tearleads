import type { ConnectRouter } from '@connectrpc/connect';
import { AuthService } from '@tearleads/shared/gen/tearleads/v1/auth_connect';
import { authConnectService } from './services/authService.js';

export function registerConnectRoutes(router: ConnectRouter): void {
  router.service(AuthService, authConnectService);
}
