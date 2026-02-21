import type { Request, Response, Router as RouterType } from 'express';
import {
  createDraftId,
  type Draft,
  type DraftRequest,
  getUserDrafts
} from './shared.js';

/**
 * @openapi
 * /emails/drafts:
 *   post:
 *     summary: Save or update a draft email
 *     description: Creates a new draft or updates an existing one
 *     tags:
 *       - Emails
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *                 description: Draft ID (omit for new draft)
 *               to:
 *                 type: array
 *                 items:
 *                   type: string
 *               cc:
 *                 type: array
 *                 items:
 *                   type: string
 *               bcc:
 *                 type: array
 *                 items:
 *                   type: string
 *               subject:
 *                 type: string
 *               body:
 *                 type: string
 *     responses:
 *       200:
 *         description: Draft saved
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 id:
 *                   type: string
 *                 updatedAt:
 *                   type: string
 *       401:
 *         description: Unauthorized
 */
const postDraftsHandler = async (
  req: Request<object, object, DraftRequest>,
  res: Response
) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { id, to, cc, bcc, subject, body, attachments } = req.body;
    const userDrafts = getUserDrafts(userId);
    const now = new Date().toISOString();

    let draft: Draft;

    const existing = id ? userDrafts.get(id) : undefined;
    if (existing) {
      draft = {
        ...existing,
        to: to ?? existing.to,
        cc: cc ?? existing.cc,
        bcc: bcc ?? existing.bcc,
        subject: subject ?? existing.subject,
        body: body ?? existing.body,
        attachments:
          attachments?.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            mimeType: a.mimeType,
            size: a.size
          })) ?? existing.attachments,
        updatedAt: now
      };
    } else {
      draft = {
        id: id ?? createDraftId(),
        to: to ?? [],
        cc: cc ?? [],
        bcc: bcc ?? [],
        subject: subject ?? '',
        body: body ?? '',
        attachments:
          attachments?.map((a) => ({
            id: a.id,
            fileName: a.fileName,
            mimeType: a.mimeType,
            size: a.size
          })) ?? [],
        createdAt: now,
        updatedAt: now
      };
    }

    userDrafts.set(draft.id, draft);

    res.json({
      id: draft.id,
      updatedAt: draft.updatedAt
    });
  } catch (error) {
    console.error('Failed to save draft:', error);
    res.status(500).json({ error: 'Failed to save draft' });
  }
};

export function registerPostDraftsRoute(routeRouter: RouterType): void {
  routeRouter.post('/drafts', postDraftsHandler);
}
