import type { Request, Response, Router as RouterType } from 'express';
import { type EmailAttachment, sendEmail } from '../../lib/emailSender.js';

interface SendRequest {
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

/**
 * @openapi
 * /vfs/emails/send:
 *   post:
 *     summary: Send an email
 *     description: Sends an email to the specified recipients.
 *     tags:
 *       - VFS
 */
const postEmailsSendHandler = async (
  req: Request<object, object, SendRequest>,
  res: Response
) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { to, cc, bcc, subject, body, attachments } = req.body;

    if (!to || to.length === 0) {
      res.status(400).json({ error: 'At least one recipient is required' });
      return;
    }

    if (!subject?.trim()) {
      res.status(400).json({ error: 'Subject is required' });
      return;
    }

    const emailAttachments: EmailAttachment[] | undefined = attachments?.map(
      (attachment) => ({
        filename: attachment.fileName,
        content: Buffer.from(attachment.content, 'base64'),
        contentType: attachment.mimeType
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

    res.json({
      success: true,
      messageId: result.messageId
    });
  } catch (error) {
    console.error('Failed to send VFS email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
};

export function registerPostEmailsSendRoute(routeRouter: RouterType): void {
  routeRouter.post('/emails/send', postEmailsSendHandler);
}
