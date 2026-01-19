import { isRecord } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';

const router: RouterType = Router();

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_OPENROUTER_MODEL = 'mistralai/mistral-7b-instruct:free';

type ChatRole = 'assistant' | 'system' | 'tool' | 'user';

interface ChatMessage {
  role: ChatRole;
  content: string;
}

function parseRole(value: unknown): ChatRole | null {
  if (
    value === 'assistant' ||
    value === 'system' ||
    value === 'tool' ||
    value === 'user'
  ) {
    return value;
  }
  return null;
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const parsed: ChatMessage[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return null;
    }
    const role = parseRole(entry['role']);
    const content = entry['content'];
    if (!role || typeof content !== 'string' || content.trim().length === 0) {
      return null;
    }
    parsed.push({ role, content });
  }
  return parsed;
}

/**
 * @openapi
 * /chat/completions:
 *   post:
 *     summary: Create a chat completion via OpenRouter
 *     description: Proxies a chat completion request to OpenRouter using a default free model.
 *     tags:
 *       - Chat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [system, user, assistant, tool]
 *                     content:
 *                       type: string
 *                 minItems: 1
 *             required:
 *               - messages
 *     responses:
 *       200:
 *         description: OpenRouter response payload
 *       400:
 *         description: Invalid request payload
 *       500:
 *         description: Server configuration error
 */
router.post('/completions', async (req: Request, res: Response) => {
  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    res.status(500).json({ error: 'OPENROUTER_API_KEY is not configured' });
    return;
  }

  const messages = parseMessages(req.body?.['messages']);
  if (!messages) {
    res.status(400).json({ error: 'messages must be a non-empty array' });
    return;
  }

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: DEFAULT_OPENROUTER_MODEL,
        messages
      })
    });

    const responseText = await response.text();
    let payload: unknown = {};
    if (responseText.trim().length > 0) {
      try {
        payload = JSON.parse(responseText);
      } catch {
        payload = { error: responseText };
      }
    }

    res.status(response.status).json(payload);
  } catch (error) {
    console.error('OpenRouter request failed:', error);
    res.status(502).json({ error: 'Failed to contact OpenRouter' });
  }
});

export { router as chatRouter, OPENROUTER_API_URL };
