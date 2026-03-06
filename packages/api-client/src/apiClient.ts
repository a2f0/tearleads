import { request } from './apiCore';
import { adminV2Routes } from './apiRoutes/adminV2Routes';
import { aiRoutes } from './apiRoutes/aiRoutes';
import { authRoutes } from './apiRoutes/authRoutes';
import { mlsRoutes } from './apiRoutes/mlsRoutes';
import { vfsRoutes } from './apiRoutes/vfsRoutes';
import { getV2PingEndpoint, parseV2PingData } from './pingContract';

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
  adminV2: adminV2Routes,
  vfs: vfsRoutes,
  ai: aiRoutes,
  mls: mlsRoutes
};
