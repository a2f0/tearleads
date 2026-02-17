import type { PingData } from '@tearleads/shared';
import { request } from './apiCore';
import { adminRoutes } from './apiRoutes/adminRoutes';
import { aiRoutes } from './apiRoutes/aiRoutes';
import { authRoutes } from './apiRoutes/authRoutes';
import { vfsRoutes } from './apiRoutes/vfsRoutes';

export const api = {
  auth: authRoutes,
  ping: {
    get: () => request<PingData>('/ping', { eventName: 'api_get_ping' })
  },
  admin: adminRoutes,
  vfs: vfsRoutes,
  ai: aiRoutes
};
