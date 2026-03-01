import { createContextKey, type HandlerContext } from '@connectrpc/connect';
import type { JwtClaims } from '../lib/jwt.js';
import type { SessionData } from '../lib/sessions.js';

export type ConnectAuthContext = {
  claims: JwtClaims;
  session: SessionData;
};

export const CONNECT_AUTH_CONTEXT_KEY =
  createContextKey<ConnectAuthContext | null>(null, {
    description: 'Authenticated JWT/session context'
  });

export function getRequiredConnectAuthContext(
  context: HandlerContext
): ConnectAuthContext | null {
  return context.values.get(CONNECT_AUTH_CONTEXT_KEY);
}
