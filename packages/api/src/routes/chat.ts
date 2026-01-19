import {
  DEFAULT_OPENROUTER_MODEL_ID,
  isOpenRouterModelId,
  isRecord
} from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';

const router: RouterType = Router();

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const DEFAULT_OPENROUTER_MODEL = DEFAULT_OPENROUTER_MODEL_ID;

type ChatRole = 'assistant' | 'system' | 'tool' | 'user';

type ChatContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

type ChatContent = string | ChatContentPart[];

interface ChatMessage {
  role: ChatRole;
  content: ChatContent;
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

function parseContentPart(value: unknown): ChatContentPart | null {
  if (!isRecord(value)) {
    return null;
  }

  const type = value['type'];
  if (type === 'text') {
    const text = value['text'];
    if (typeof text !== 'string' || text.trim().length === 0) {
      return null;
    }
    return { type: 'text', text };
  }

  if (type === 'image_url') {
    const imageUrl = value['image_url'];
    if (!isRecord(imageUrl)) {
      return null;
    }
    const url = imageUrl['url'];
    if (typeof url !== 'string' || url.trim().length === 0) {
      return null;
    }
    return { type: 'image_url', image_url: { url } };
  }

  return null;
}

function parseContent(value: unknown): ChatContent | null {
  if (typeof value === 'string') {
    if (value.trim().length === 0) {
      return null;
    }
    return value;
  }

  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const parsedParts: ChatContentPart[] = [];
  for (const entry of value) {
    const parsedPart = parseContentPart(entry);
    if (!parsedPart) {
      return null;
    }
    parsedParts.push(parsedPart);
  }

  return parsedParts;
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
    const content = parseContent(entry['content']);
    if (!role || !content) {
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
 *               model:
 *                 type: string
 *                 description: Optional OpenRouter model ID (defaults to the free model)
 *               messages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     role:
 *                       type: string
 *                       enum: [system, user, assistant, tool]
 *                     content:
 *                       oneOf:
 *                         - type: string
 *                         - type: array
 *                           items:
 *                             type: object
 *                             properties:
 *                               type:
 *                                 type: string
 *                                 enum: [text, image_url]
 *                               text:
 *                                 type: string
 *                               image_url:
 *                                 type: object
 *                                 properties:
 *                                   url:
 *                                     type: string
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
  const messages = parseMessages(req.body?.['messages']);
  if (!messages) {
    res.status(400).json({
      error: 'messages must be a non-empty array of { role, content }'
    });
    return;
  }

  let modelId = DEFAULT_OPENROUTER_MODEL_ID;
  if (isRecord(req.body) && req.body['model'] !== undefined) {
    const modelValue = req.body['model'];
    if (typeof modelValue !== 'string' || !isOpenRouterModelId(modelValue)) {
      res.status(400).json({
        error: 'model must be a supported OpenRouter chat model'
      });
      return;
    }
    modelId = modelValue;
  }

  const apiKey = process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    res.status(500).json({
      error: 'OPENROUTER_API_KEY is not configured on the server'
    });
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
        model: modelId,
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
