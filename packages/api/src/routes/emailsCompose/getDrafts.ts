import type { Request, Response, Router as RouterType } from 'express';
import { getUserDrafts } from './shared.js';

/**
 * @openapi
 * /emails/drafts:
 *   get:
 *     summary: List all drafts
 *     description: Returns all draft emails for the authenticated user
 *     tags:
 *       - Emails
 *     responses:
 *       200:
 *         description: List of drafts
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 drafts:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       to:
 *                         type: array
 *                         items:
 *                           type: string
 *                       subject:
 *                         type: string
 *                       updatedAt:
 *                         type: string
 *       401:
 *         description: Unauthorized
 */
const getDraftsHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const userDrafts = getUserDrafts(userId);
    const drafts = Array.from(userDrafts.values())
      .map((d) => ({
        id: d.id,
        to: d.to,
        subject: d.subject,
        updatedAt: d.updatedAt
      }))
      .sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );

    res.json({ drafts });
  } catch (error) {
    console.error('Failed to list drafts:', error);
    res.status(500).json({ error: 'Failed to list drafts' });
  }
};

export function registerGetDraftsRoute(routeRouter: RouterType): void {
  routeRouter.get('/drafts', getDraftsHandler);
}
