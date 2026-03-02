import type {
  AuthResponse,
  SessionsResponse,
  UserOrganizationsResponse,
  VfsKeySetupRequest
} from '@tearleads/shared';
import { request } from '../apiCore';

const AUTH_CONNECT_BASE_PATH = '/connect/tearleads.v1.AuthService';

function jsonPost(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

export const authRoutes = {
  login: (email: string, password: string) =>
    request<AuthResponse>(`${AUTH_CONNECT_BASE_PATH}/Login`, {
      fetchOptions: jsonPost({ email, password }),
      eventName: 'api_post_auth_login',
      skipTokenRefresh: true
    }),
  register: (
    email: string,
    password: string,
    vfsKeySetup?: VfsKeySetupRequest
  ) =>
    request<AuthResponse>(`${AUTH_CONNECT_BASE_PATH}/Register`, {
      fetchOptions: jsonPost({
        email,
        password,
        ...(vfsKeySetup ? { vfsKeySetup } : {})
      }),
      eventName: 'api_post_auth_register',
      skipTokenRefresh: true
    }),
  getSessions: () =>
    request<SessionsResponse>(`${AUTH_CONNECT_BASE_PATH}/GetSessions`, {
      fetchOptions: jsonPost({}),
      eventName: 'api_get_auth_sessions'
    }),
  deleteSession: (sessionId: string) =>
    request<{ deleted: boolean }>(`${AUTH_CONNECT_BASE_PATH}/DeleteSession`, {
      fetchOptions: jsonPost({ sessionId }),
      eventName: 'api_delete_auth_session'
    }),
  logout: () =>
    request<{ loggedOut: boolean }>(`${AUTH_CONNECT_BASE_PATH}/Logout`, {
      fetchOptions: jsonPost({}),
      eventName: 'api_post_auth_logout'
    }),
  getOrganizations: () =>
    request<UserOrganizationsResponse>(
      `${AUTH_CONNECT_BASE_PATH}/GetOrganizations`,
      {
        fetchOptions: jsonPost({}),
        eventName: 'api_get_auth_organizations'
      }
    )
};
