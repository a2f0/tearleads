import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getRedisClient } from '../lib/redis.js';

const EMAIL_PREFIX = 'smtp:email:';
const EMAIL_LIST_KEY = 'smtp:emails';

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
 *     summary: List all emails
 *     description: Returns a list of all stored emails with parsed metadata
 *     tags:
 *       - Emails
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
 *       500:
 *         description: Server error
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const client = await getRedisClient();
    const emailIds = await client.lRange(EMAIL_LIST_KEY, 0, -1);

    const emails: EmailListItem[] = [];

    for (const id of emailIds) {
      const data = await client.get(`${EMAIL_PREFIX}${id}`);
      if (data) {
        const email: StoredEmail = JSON.parse(data);
        emails.push({
          id: email.id,
          from: formatEmailAddress(email.envelope.mailFrom),
          to: email.envelope.rcptTo.map((r) => r.address),
          subject: extractSubject(email.rawData),
          receivedAt: email.receivedAt,
          size: email.size
        });
      }
    }

    res.json({ emails });
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
    const { id } = req.params;
    const client = await getRedisClient();
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
    const { id } = req.params;
    const client = await getRedisClient();
    const key = `${EMAIL_PREFIX}${id}`;
    const deleted = await client.del(key);

    if (deleted > 0) {
      await client.lRem(EMAIL_LIST_KEY, 1, id);
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Email not found' });
    }
  } catch (error) {
    console.error('Failed to delete email:', error);
    res.status(500).json({ error: 'Failed to delete email' });
  }
});

export { router as emailsRouter };
