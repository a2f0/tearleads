import type { Request, Response, Router as RouterType } from 'express';
import { getSessionsByUserId } from '../../lib/sessions.js';

/**
 * @openapi
 * /auth/sessions:
 *   get:
 *     summary: List all active sessions for the current user
 *     description: Returns all sessions with metadata. Requires authentication.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of sessions
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const getSessionsHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const sessions = await getSessionsByUserId(claims.sub);
    const response = sessions.map((session) => ({
      id: session.id,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      ipAddress: session.ipAddress,
      isCurrent: session.id === claims.jti,
      isAdmin: session.admin
    }));

    res.json({ sessions: response });
  } catch (error) {
    console.error('Failed to list sessions:', error);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
};

export function registerGetSessionsRoute(authRouter: RouterType): void {
  authRouter.get('/sessions', getSessionsHandler);
}
