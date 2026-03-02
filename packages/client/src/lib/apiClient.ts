import { request } from './apiCore';
import { adminRoutes } from './apiRoutes/adminRoutes';
import { aiRoutes } from './apiRoutes/aiRoutes';
import { authRoutes } from './apiRoutes/authRoutes';
import { getV2PingEndpoint, parseV2PingData } from './pingContract';
import { vfsRoutes } from './apiRoutes/vfsRoutes';

export const api = {
  auth: authRoutes,
  ping: {
    get: async () => {
      const endpoint = await getV2PingEndpoint();
      const response = await request<unknown>(endpoint, {
        eventName: 'api_get_ping'
      });
      return parseV2PingData(response);
    }
  },
  admin: adminRoutes,
  vfs: vfsRoutes,
  ai: aiRoutes
};
