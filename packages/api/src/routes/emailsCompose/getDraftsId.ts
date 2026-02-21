import type { Request, Response, Router as RouterType } from 'express';
import { getUserDrafts } from './shared.js';

/**
 * @openapi
 * /emails/drafts/{id}:
 *   get:
 *     summary: Get a draft by ID
 *     description: Returns a single draft email
 *     tags:
 *       - Emails
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Draft ID
 *     responses:
 *       200:
 *         description: Draft details
 *       404:
 *         description: Draft not found
 *       401:
 *         description: Unauthorized
 */
const getDraftsIdHandler = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id } = req.params;
    const userDrafts = getUserDrafts(userId);
    const draft = userDrafts.get(id);

    if (!draft) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    res.json(draft);
  } catch (error) {
    console.error('Failed to get draft:', error);
    res.status(500).json({ error: 'Failed to get draft' });
  }
};

export function registerGetDraftsIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/drafts/:id', getDraftsIdHandler);
}
