import type { Request, Response, Router as RouterType } from 'express';
import { deleteSession } from '../../lib/sessions.js';

/**
 * @openapi
 * /auth/logout:
 *   post:
 *     summary: Logout and invalidate current session
 *     description: Deletes the current session and refresh token.
 *     tags:
 *       - Auth
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const postLogoutHandler = async (
  req: Request,
  res: Response
): Promise<void> => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    await deleteSession(claims.jti, claims.sub);

    res.json({ loggedOut: true });
  } catch (error) {
    console.error('Failed to logout:', error);
    res.status(500).json({ error: 'Failed to logout' });
  }
};

export function registerPostLogoutRoute(authRouter: RouterType): void {
  authRouter.post('/logout', postLogoutHandler);
}
