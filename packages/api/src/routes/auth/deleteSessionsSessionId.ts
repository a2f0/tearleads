import type { Request, Response, Router as RouterType } from 'express';
import { deleteSession } from '../../lib/sessions.js';

/**
 * @openapi
 * /auth/sessions/{sessionId}:
 *   delete:
 *     summary: Delete a session
 *     description: Revokes a session. Cannot delete the current session.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session deleted
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Cannot delete current session
 *       404:
 *         description: Session not found
 *       500:
 *         description: Server error
 */
const deleteSessionsSessionIdHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { sessionId } = req.params;
  if (!sessionId || typeof sessionId !== 'string') {
    res.status(400).json({ error: 'Session ID is required' });
    return;
  }

  if (sessionId === claims.jti) {
    res.status(403).json({ error: 'Cannot delete current session' });
    return;
  }

  try {
    const deleted = await deleteSession(sessionId, claims.sub);
    if (!deleted) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json({ deleted: true });
  } catch (error) {
    console.error('Failed to delete session:', error);
    res.status(500).json({ error: 'Failed to delete session' });
  }
};

export function registerDeleteSessionsSessionIdRoute(
  authRouter: RouterType
): void {
  authRouter.delete('/sessions/:sessionId', deleteSessionsSessionIdHandler);
}
