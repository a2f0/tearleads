import type { AuthResponse, SessionsResponse } from '@tearleads/shared';
import { createConnectJsonPostInit } from '@tearleads/shared';
import { request } from '../apiCore';

const AUTH_CONNECT_BASE_PATH = '/connect/tearleads.v1.AuthService';

export const authRoutes = {
  login: (email: string, password: string) =>
    request<AuthResponse>(`${AUTH_CONNECT_BASE_PATH}/Login`, {
      fetchOptions: createConnectJsonPostInit({ email, password }),
      eventName: 'api_post_auth_login',
      skipTokenRefresh: true
    }),
  register: (email: string, password: string) =>
    request<AuthResponse>(`${AUTH_CONNECT_BASE_PATH}/Register`, {
      fetchOptions: createConnectJsonPostInit({ email, password }),
      eventName: 'api_post_auth_register',
      skipTokenRefresh: true
    }),
  getSessions: () =>
    request<SessionsResponse>(`${AUTH_CONNECT_BASE_PATH}/GetSessions`, {
      fetchOptions: createConnectJsonPostInit({}),
      eventName: 'api_get_auth_sessions'
    }),
  deleteSession: (sessionId: string) =>
    request<{ deleted: boolean }>(`${AUTH_CONNECT_BASE_PATH}/DeleteSession`, {
      fetchOptions: createConnectJsonPostInit({ sessionId }),
      eventName: 'api_delete_auth_session'
    }),
  logout: () =>
    request<{ loggedOut: boolean }>(`${AUTH_CONNECT_BASE_PATH}/Logout`, {
      fetchOptions: createConnectJsonPostInit({}),
      eventName: 'api_post_auth_logout'
    })
};
