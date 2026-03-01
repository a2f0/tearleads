import { login } from './auth/login.js';
import { refreshToken } from './auth/refreshToken.js';
import { register } from './auth/register.js';
import {
  deleteSessionHandler,
  getOrganizations,
  getSessionsHandler,
  logout
} from './auth/sessionManagement.js';

export const authConnectService = {
  login,
  register,
  refreshToken,
  getSessions: getSessionsHandler,
  deleteSession: deleteSessionHandler,
  logout,
  getOrganizations
};
