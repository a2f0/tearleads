import type {
  AuthResponse,
  SessionsResponse,
  UserOrganizationsResponse,
  VfsKeySetupRequest
} from '@tearleads/shared';
import { request } from '../apiCore';

export const authRoutes = {
  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      },
      eventName: 'api_post_auth_login',
      skipTokenRefresh: true
    }),
  register: (
    email: string,
    password: string,
    vfsKeySetup?: VfsKeySetupRequest
  ) =>
    request<AuthResponse>('/auth/register', {
      fetchOptions: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          ...(vfsKeySetup ? { vfsKeySetup } : {})
        })
      },
      eventName: 'api_post_auth_register',
      skipTokenRefresh: true
    }),
  getSessions: () =>
    request<SessionsResponse>('/auth/sessions', {
      eventName: 'api_get_auth_sessions'
    }),
  deleteSession: (sessionId: string) =>
    request<{ deleted: boolean }>(
      `/auth/sessions/${encodeURIComponent(sessionId)}`,
      {
        fetchOptions: { method: 'DELETE' },
        eventName: 'api_delete_auth_session'
      }
    ),
  logout: () =>
    request<{ loggedOut: boolean }>('/auth/logout', {
      fetchOptions: { method: 'POST' },
      eventName: 'api_post_auth_logout'
    }),
  getOrganizations: () =>
    request<UserOrganizationsResponse>('/auth/organizations', {
      eventName: 'api_get_auth_organizations'
    })
};
