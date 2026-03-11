import type {
  AuthResponse,
  SessionsResponse,
  UserOrganizationsResponse,
  VfsKeySetupRequest
} from '@tearleads/shared';
import { createConnectJsonPostInit } from '@tearleads/shared';
import { request } from '../apiCore';
import {
  AUTH_V2_CONNECT_BASE_PATH,
  AUTH_V2_GET_ORGANIZATIONS_CONNECT_PATH,
  AUTH_V2_GET_SESSIONS_CONNECT_PATH,
  AUTH_V2_LOGIN_CONNECT_PATH,
  AUTH_V2_LOGOUT_CONNECT_PATH,
  AUTH_V2_REGISTER_CONNECT_PATH
} from '../connectRoutes';

export const authRoutes = {
  login: (email: string, password: string) =>
    request<AuthResponse>(AUTH_V2_LOGIN_CONNECT_PATH, {
      fetchOptions: createConnectJsonPostInit({ email, password }),
      eventName: 'api_post_auth_login',
      skipTokenRefresh: true
    }),
  register: (
    email: string,
    password: string,
    vfsKeySetup?: VfsKeySetupRequest
  ) =>
    request<AuthResponse>(AUTH_V2_REGISTER_CONNECT_PATH, {
      fetchOptions: createConnectJsonPostInit({
        email,
        password,
        ...(vfsKeySetup ? { vfsKeySetup } : {})
      }),
      eventName: 'api_post_auth_register',
      skipTokenRefresh: true
    }),
  getSessions: () =>
    request<SessionsResponse>(AUTH_V2_GET_SESSIONS_CONNECT_PATH, {
      fetchOptions: createConnectJsonPostInit({}),
      eventName: 'api_get_auth_sessions'
    }),
  deleteSession: (sessionId: string) =>
    request<{ deleted: boolean }>(`${AUTH_V2_CONNECT_BASE_PATH}/DeleteSession`, {
      fetchOptions: createConnectJsonPostInit({ sessionId }),
      eventName: 'api_delete_auth_session'
    }),
  logout: () =>
    request<{ loggedOut: boolean }>(AUTH_V2_LOGOUT_CONNECT_PATH, {
      fetchOptions: createConnectJsonPostInit({}),
      eventName: 'api_post_auth_logout'
    }),
  getOrganizations: () =>
    request<UserOrganizationsResponse>(AUTH_V2_GET_ORGANIZATIONS_CONNECT_PATH, {
      fetchOptions: createConnectJsonPostInit({}),
      eventName: 'api_get_auth_organizations'
    })
};
