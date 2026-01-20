import {
  type ChatMessage,
  DEFAULT_OPENROUTER_MODEL_ID,
  isOpenRouterModelId,
  isRecord,
  validateChatMessages
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
  const messageResult = validateChatMessages(req.body?.['messages']);
  if (!messageResult.ok) {
    res.status(400).json({ error: messageResult.error });
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
    const messages: ChatMessage[] = messageResult.messages;
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
