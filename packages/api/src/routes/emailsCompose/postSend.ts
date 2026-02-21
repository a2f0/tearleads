import type { Request, Response, Router as RouterType } from 'express';
import { type EmailAttachment, sendEmail } from '../../lib/emailSender.js';
import { getUserDrafts, type SendRequest } from './shared.js';

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
const postSendHandler = async (
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

export function registerPostSendRoute(routeRouter: RouterType): void {
  routeRouter.post('/send', postSendHandler);
}
