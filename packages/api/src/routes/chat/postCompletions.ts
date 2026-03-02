// COMPLIANCE_SENTINEL: TL-VENDOR-007 | control=openrouter-vendor
import type { Request, Response, Router as RouterType } from 'express';
import { createChatCompletion } from '../../lib/chatCompletions.js';

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
const postCompletionsHandler = async (req: Request, res: Response) => {
  const result = await createChatCompletion({
    body: req.body,
    ...(req.authClaims ? { authUserId: req.authClaims.sub } : {})
  });
  res.status(result.status).json(result.payload);
};

export function registerPostCompletionsRoute(routeRouter: RouterType): void {
  routeRouter.post('/completions', postCompletionsHandler);
}
