import { getRedisClient } from '@tearleads/shared/redis';
import type { Request, Response, Router as RouterType } from 'express';
import {
  type EmailListItem,
  extractSubject,
  formatEmailAddress,
  getEmailKey,
  getEmailListKey,
  type StoredEmail
} from './shared.js';

/**
 * @openapi
 * /emails:
 *   get:
 *     summary: List emails with pagination
 *     description: Returns a paginated list of stored emails with parsed metadata
 *     tags:
 *       - Emails
 *     parameters:
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of emails to skip
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Maximum number of emails to return
 *     responses:
 *       200:
 *         description: List of emails
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 emails:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                       from:
 *                         type: string
 *                       to:
 *                         type: array
 *                         items:
 *                           type: string
 *                       subject:
 *                         type: string
 *                       receivedAt:
 *                         type: string
 *                       size:
 *                         type: number
 *                 total:
 *                   type: integer
 *                   description: Total number of emails
 *                 offset:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *       500:
 *         description: Server error
 */
const getRootHandler = async (req: Request, res: Response) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const offset = Math.max(
      0,
      parseInt(req.query['offset'] as string, 10) || 0
    );
    const limit = Math.min(
      100,
      Math.max(1, parseInt(req.query['limit'] as string, 10) || 50)
    );

    const client = await getRedisClient();
    const emailListKey = getEmailListKey(userId);
    const total = await client.lLen(emailListKey);
    const emailIds = await client.lRange(
      emailListKey,
      offset,
      offset + limit - 1
    );

    if (emailIds.length === 0) {
      res.json({ emails: [], total, offset, limit });
      return;
    }

    const keys = emailIds.map((id) => getEmailKey(id));
    const results = await client.mGet(keys);

    const emails: EmailListItem[] = [];
    for (let i = 0; i < results.length; i++) {
      const data = results[i];
      if (data) {
        try {
          const email: StoredEmail = JSON.parse(data);
          emails.push({
            id: email.id,
            from: formatEmailAddress(email.envelope.mailFrom),
            to: email.envelope.rcptTo.map((r) => r.address),
            subject: extractSubject(email.rawData),
            receivedAt: email.receivedAt,
            size: email.size
          });
        } catch (parseError) {
          console.error(
            `Failed to parse email data for id ${emailIds[i]}:`,
            parseError
          );
        }
      }
    }

    res.json({ emails, total, offset, limit });
  } catch (error) {
    console.error('Failed to list emails:', error);
    res.status(500).json({ error: 'Failed to list emails' });
  }
};

export function registerGetRootRoute(routeRouter: RouterType): void {
  routeRouter.get('/', getRootHandler);
}
