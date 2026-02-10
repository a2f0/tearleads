import { randomUUID } from 'node:crypto';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { type EmailAttachment, sendEmail } from '../lib/emailSender.js';
import { registerDeleteDraftsIdRoute } from './emailsCompose/delete-drafts-id.js';
import { registerGetDraftsRoute } from './emailsCompose/get-drafts.js';
import { registerGetDraftsIdRoute } from './emailsCompose/get-drafts-id.js';
import { registerPostDraftsRoute } from './emailsCompose/post-drafts.js';
import { registerPostSendRoute } from './emailsCompose/post-send.js';

interface DraftRequest {
  id?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body?: string;
  attachments?: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
    content?: string;
  }>;
}

interface SendRequest {
  draftId?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments?: Array<{
    fileName: string;
    mimeType: string;
    content: string;
  }>;
}

interface Draft {
  id: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  body: string;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    size: number;
  }>;
  createdAt: string;
  updatedAt: string;
}

const draftsStore = new Map<string, Map<string, Draft>>();

function getUserDrafts(userId: string): Map<string, Draft> {
  let userDrafts = draftsStore.get(userId);
  if (!userDrafts) {
    userDrafts = new Map();
    draftsStore.set(userId, userDrafts);
  }
  return userDrafts;
}

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
export const postDraftsHandler = async (
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
        id: id ?? randomUUID(),
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
export const getDraftsHandler = async (req: Request, res: Response) => {
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
export const getDraftsIdHandler = async (
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
export const deleteDraftsIdHandler = async (
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

/**
 * @openapi
 * /emails/send:
 *   post:
 *     summary: Send an email
 *     description: Sends an email to the specified recipients
 *     tags:
 *       - Emails
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - to
 *               - subject
 *               - body
 *             properties:
 *               draftId:
 *                 type: string
 *                 description: Optional draft ID to delete after sending
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
 *         description: Email sent successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 messageId:
 *                   type: string
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Failed to send
 */
export const postSendHandler = async (
  req: Request<object, object, SendRequest>,
  res: Response
) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { draftId, to, cc, bcc, subject, body, attachments } = req.body;

    if (!to || to.length === 0) {
      res.status(400).json({ error: 'At least one recipient is required' });
      return;
    }

    if (!subject?.trim()) {
      res.status(400).json({ error: 'Subject is required' });
      return;
    }

    const emailAttachments: EmailAttachment[] | undefined = attachments?.map(
      (a) => ({
        filename: a.fileName,
        content: Buffer.from(a.content, 'base64'),
        contentType: a.mimeType
      })
    );

    const result = await sendEmail({
      to,
      ...(cc && cc.length > 0 ? { cc } : {}),
      ...(bcc && bcc.length > 0 ? { bcc } : {}),
      subject,
      text: body,
      ...(emailAttachments ? { attachments: emailAttachments } : {})
    });

    if (!result.success) {
      res.status(500).json({ error: result.error ?? 'Failed to send email' });
      return;
    }

    if (draftId) {
      const userDrafts = getUserDrafts(userId);
      userDrafts.delete(draftId);
    }

    res.json({
      success: true,
      messageId: result.messageId
    });
  } catch (error) {
    console.error('Failed to send email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
};

const emailsComposeRouter: RouterType = Router();
registerPostDraftsRoute(emailsComposeRouter);
registerGetDraftsRoute(emailsComposeRouter);
registerGetDraftsIdRoute(emailsComposeRouter);
registerDeleteDraftsIdRoute(emailsComposeRouter);
registerPostSendRoute(emailsComposeRouter);

export { emailsComposeRouter };
