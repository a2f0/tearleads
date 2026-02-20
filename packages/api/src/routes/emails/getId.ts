import { getRedisClient } from '@tearleads/shared/redis';
import type { Request, Response, Router as RouterType } from 'express';
import {
  extractSubject,
  formatEmailAddress,
  getEmailKey,
  getEmailUsersKey,
  type StoredEmail
} from './shared.js';

/**
 * @openapi
 * /emails/{id}:
 *   get:
 *     summary: Get email by ID
 *     description: Returns a single email with full raw data
 *     tags:
 *       - Emails
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Email ID
 *     responses:
 *       200:
 *         description: Email details
 *       404:
 *         description: Email not found
 *       500:
 *         description: Server error
 */
export const getIdHandler = async (
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
    const client = await getRedisClient();
    const usersKey = getEmailUsersKey(id);
    const hasAccess = await client.sIsMember(usersKey, userId);
    if (hasAccess !== 1) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }
    const data = await client.get(getEmailKey(id));

    if (!data) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    const email: StoredEmail = JSON.parse(data);
    res.json({
      id: email.id,
      from: formatEmailAddress(email.envelope.mailFrom),
      to: email.envelope.rcptTo.map((r) => r.address),
      subject: extractSubject(email.rawData),
      receivedAt: email.receivedAt,
      size: email.size,
      rawData: email.rawData
    });
  } catch (error) {
    console.error('Failed to get email:', error);
    res.status(500).json({ error: 'Failed to get email' });
  }
};

export function registerGetIdRoute(routeRouter: RouterType): void {
  routeRouter.get('/:id', getIdHandler);
}
