import type { JwtClaims } from '../lib/jwt.js';
import type { SessionData } from '../lib/sessions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authClaims?: JwtClaims;
      session?: SessionData;
      organizationId?: string;
    }
  }
}

export {};
