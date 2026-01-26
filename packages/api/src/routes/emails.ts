import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getRedisClient } from '../lib/redis.js';

const EMAIL_PREFIX = 'smtp:email:';
const EMAIL_LIST_PREFIX = 'smtp:emails:';
const EMAIL_USERS_PREFIX = 'smtp:email:users:';

const getEmailListKey = (userId: string): string =>
  `${EMAIL_LIST_PREFIX}${userId}`;
const getEmailUsersKey = (emailId: string): string =>
  `${EMAIL_USERS_PREFIX}${emailId}`;

interface EmailAddress {
  address: string;
  name?: string;
}

interface StoredEmail {
  id: string;
  envelope: {
    mailFrom: EmailAddress | false;
    rcptTo: EmailAddress[];
  };
  rawData: string;
  receivedAt: string;
  size: number;
}

interface EmailListItem {
  id: string;
  from: string;
  to: string[];
  subject: string;
  receivedAt: string;
  size: number;
}

function extractSubject(rawData: string): string {
  const lines = rawData.split('\n');
  for (const line of lines) {
    if (line.toLowerCase().startsWith('subject:')) {
      return line.slice(8).trim();
    }
    if (line.trim() === '') {
      break;
    }
  }
  return '';
}

function formatEmailAddress(addr: EmailAddress | false): string {
  if (!addr) {
    return '';
  }
  if (addr.name) {
    return `${addr.name} <${addr.address}>`;
  }
  return addr.address;
}

const router: RouterType = Router();

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
router.get('/', async (req: Request, res: Response) => {
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

    const keys = emailIds.map((id) => `${EMAIL_PREFIX}${id}`);
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
});

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
router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
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
    const data = await client.get(`${EMAIL_PREFIX}${id}`);

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
});

/**
 * @openapi
 * /emails/{id}:
 *   delete:
 *     summary: Delete email by ID
 *     description: Deletes a single email
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
 *         description: Email deleted
 *       404:
 *         description: Email not found
 *       500:
 *         description: Server error
 */
router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  try {
    const userId = req.authClaims?.sub;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const { id } = req.params;
    const client = await getRedisClient();
    const key = `${EMAIL_PREFIX}${id}`;
    const usersKey = getEmailUsersKey(id);
    const hasAccess = await client.sIsMember(usersKey, userId);

    if (hasAccess !== 1) {
      res.status(404).json({ error: 'Email not found' });
      return;
    }

    await client.sRem(usersKey, userId);
    await client.lRem(getEmailListKey(userId), 1, id);
    const remainingUsers = await client.sCard(usersKey);
    let deletedCount = 0;
    if (remainingUsers === 0) {
      const results = await client.multi().del(key).del(usersKey).exec();
      const delResult = results?.[0];
      deletedCount =
        typeof delResult === 'number'
          ? delResult
          : Array.isArray(delResult) && typeof delResult[1] === 'number'
            ? delResult[1]
            : 0;
    }

    if (remainingUsers > 0 || deletedCount > 0) {
      res.json({ success: true });
      return;
    }

    res.status(404).json({ error: 'Email not found' });
  } catch (error) {
    console.error('Failed to delete email:', error);
    res.status(500).json({ error: 'Failed to delete email' });
  }
});

export { router as emailsRouter };
