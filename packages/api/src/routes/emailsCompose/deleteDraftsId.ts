import type { Request, Response, Router as RouterType } from 'express';
import { getUserDrafts } from './shared.js';

/**
 * @openapi
 * /emails/drafts/{id}:
 *   delete:
 *     summary: Delete a draft
 *     description: Deletes a draft email
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
 *         description: Draft deleted
 *       404:
 *         description: Draft not found
 *       401:
 *         description: Unauthorized
 */
const deleteDraftsIdHandler = async (
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

    if (!userDrafts.has(id)) {
      res.status(404).json({ error: 'Draft not found' });
      return;
    }

    userDrafts.delete(id);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete draft:', error);
    res.status(500).json({ error: 'Failed to delete draft' });
  }
};

export function registerDeleteDraftsIdRoute(routeRouter: RouterType): void {
  routeRouter.delete('/drafts/:id', deleteDraftsIdHandler);
}
