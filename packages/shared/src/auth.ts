import type { VfsKeySetupRequest } from './vfsTypes.js';

/**
 * Shared Auth types
 */

export interface AuthUser {
  id: string;
  email: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  vfsKeySetup?: VfsKeySetupRequest;
}

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_COMPLEXITY_ERROR =
  'Password must include at least one uppercase letter, one lowercase letter, one number, and one symbol';

export function passwordMeetsComplexity(password: string): boolean {
  return (
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^\w\s]/.test(password)
  );
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: number;
  refreshExpiresIn: number;
  user: AuthUser;
}

export interface Session {
  id: string;
  createdAt: string;
  lastActiveAt: string;
  ipAddress: string;
  isCurrent: boolean;
  isAdmin: boolean;
}

export interface SessionsResponse {
  sessions: Session[];
}

export interface UserOrganization {
  id: string;
  name: string;
  isPersonal: boolean;
}

export interface UserOrganizationsResponse {
  organizations: UserOrganization[];
  personalOrganizationId: string;
}
