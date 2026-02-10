import { registerPostCompletionsRoute } from './chat/post-completions.js';
import { randomUUID } from 'node:crypto';
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
import { getPostgresPool } from '../lib/postgres.js';



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
export const postCompletionsHandler = async (req: Request, res: Response) => {
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

    // Record usage if authenticated and response contains usage data
    if (
      response.ok &&
      req.authClaims &&
      isRecord(payload) &&
      isRecord(payload['usage'])
    ) {
      const usage = payload['usage'];
      const promptTokens =
        typeof usage['prompt_tokens'] === 'number' ? usage['prompt_tokens'] : 0;
      const completionTokens =
        typeof usage['completion_tokens'] === 'number'
          ? usage['completion_tokens']
          : 0;
      const totalTokens =
        typeof usage['total_tokens'] === 'number'
          ? usage['total_tokens']
          : promptTokens + completionTokens;
      const openrouterRequestId =
        typeof payload['id'] === 'string' ? payload['id'] : null;

      // Get user's org if they have one
      try {
        const pool = await getPostgresPool();
        const orgResult = await pool.query<{ organization_id: string }>(
          'SELECT organization_id FROM user_organizations WHERE user_id = $1 LIMIT 1',
          [req.authClaims.sub]
        );
        const orgId = orgResult.rows[0]?.organization_id ?? null;

        // Record usage asynchronously (don't block response)
        pool
          .query(
            `INSERT INTO ai_usage (
            id, user_id, organization_id, model_id,
            prompt_tokens, completion_tokens, total_tokens,
            openrouter_request_id, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
            [
              randomUUID(),
              req.authClaims.sub,
              orgId,
              modelId,
              promptTokens,
              completionTokens,
              totalTokens,
              openrouterRequestId
            ]
          )
          .catch((err) => {
            console.error('Failed to record AI usage:', err);
          });
      } catch (err) {
        console.error('Failed to get user org for usage tracking:', err);
      }
    }

    res.status(response.status).json(payload);
  } catch (error) {
    console.error('OpenRouter request failed:', error);
    res.status(502).json({ error: 'Failed to contact OpenRouter' });
  }
};

const chatRouter: RouterType = Router();
registerPostCompletionsRoute(chatRouter);

export { chatRouter, OPENROUTER_API_URL };
