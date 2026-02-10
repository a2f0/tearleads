/**
 * AI Conversations API routes.
 *
 * Handles conversation management and usage tracking for AI features.
 */

import { randomUUID } from 'node:crypto';
import type {
  AddAiMessageRequest,
  AddAiMessageResponse,
  AiConversationDetailResponse,
  AiConversationResponse,
  AiConversationsListResponse,
  AiMessageRole,
  AiUsageListResponse,
  AiUsageSummaryResponse,
  CreateAiConversationRequest,
  CreateAiConversationResponse,
  RecordAiUsageRequest,
  RecordAiUsageResponse,
  UpdateAiConversationRequest
} from '@rapid/shared';
import { isRecord } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { getPostgresPool } from '../lib/postgres.js';
import { registerDeleteConversationsIdRoute } from './ai-conversations/delete-conversations-id.js';
import { registerGetConversationsRoute } from './ai-conversations/get-conversations.js';
import { registerGetConversationsIdRoute } from './ai-conversations/get-conversations-id.js';
import { registerGetUsageRoute } from './ai-conversations/get-usage.js';
import { registerGetUsageSummaryRoute } from './ai-conversations/get-usage-summary.js';
import { registerPatchConversationsIdRoute } from './ai-conversations/patch-conversations-id.js';
import { registerPostConversationsRoute } from './ai-conversations/post-conversations.js';
import { registerPostConversationsIdMessagesRoute } from './ai-conversations/post-conversations-id-messages.js';
import { registerPostUsageRoute } from './ai-conversations/post-usage.js';

const VALID_MESSAGE_ROLES: AiMessageRole[] = ['system', 'user', 'assistant'];

function isValidMessageRole(value: unknown): value is AiMessageRole {
  return (
    typeof value === 'string' &&
    VALID_MESSAGE_ROLES.includes(value as AiMessageRole)
  );
}

function parseCreateConversationPayload(
  body: unknown
): CreateAiConversationRequest | null {
  if (!isRecord(body)) {
    return null;
  }
  const encryptedTitle = body['encryptedTitle'];
  const encryptedSessionKey = body['encryptedSessionKey'];
  const modelId = body['modelId'];

  if (
    typeof encryptedTitle !== 'string' ||
    typeof encryptedSessionKey !== 'string'
  ) {
    return null;
  }

  if (!encryptedTitle.trim() || !encryptedSessionKey.trim()) {
    return null;
  }

  return {
    encryptedTitle: encryptedTitle.trim(),
    encryptedSessionKey: encryptedSessionKey.trim(),
    ...(typeof modelId === 'string' && modelId.trim()
      ? { modelId: modelId.trim() }
      : {})
  };
}

function parseUpdateConversationPayload(
  body: unknown
): UpdateAiConversationRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const encryptedTitle = body['encryptedTitle'];
  const modelId = body['modelId'];

  const result: UpdateAiConversationRequest = {};

  if (typeof encryptedTitle === 'string' && encryptedTitle.trim()) {
    result.encryptedTitle = encryptedTitle.trim();
  }

  if (typeof modelId === 'string') {
    const trimmed = modelId.trim();
    if (trimmed) {
      result.modelId = trimmed;
    }
  }

  if (Object.keys(result).length === 0) {
    return null;
  }

  return result;
}

function parseAddMessagePayload(body: unknown): AddAiMessageRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const role = body['role'];
  const encryptedContent = body['encryptedContent'];
  const modelId = body['modelId'];

  if (!isValidMessageRole(role) || typeof encryptedContent !== 'string') {
    return null;
  }

  if (!encryptedContent.trim()) {
    return null;
  }

  return {
    role,
    encryptedContent: encryptedContent.trim(),
    ...(typeof modelId === 'string' && modelId.trim()
      ? { modelId: modelId.trim() }
      : {})
  };
}

function parseRecordUsagePayload(body: unknown): RecordAiUsageRequest | null {
  if (!isRecord(body)) {
    return null;
  }

  const conversationId = body['conversationId'];
  const messageId = body['messageId'];
  const modelId = body['modelId'];
  const promptTokens = body['promptTokens'];
  const completionTokens = body['completionTokens'];
  const totalTokens = body['totalTokens'];
  const openrouterRequestId = body['openrouterRequestId'];

  if (
    typeof modelId !== 'string' ||
    typeof promptTokens !== 'number' ||
    typeof completionTokens !== 'number' ||
    typeof totalTokens !== 'number'
  ) {
    return null;
  }

  if (!modelId.trim()) {
    return null;
  }

  return {
    ...(typeof conversationId === 'string' && conversationId.trim()
      ? { conversationId: conversationId.trim() }
      : {}),
    ...(typeof messageId === 'string' && messageId.trim()
      ? { messageId: messageId.trim() }
      : {}),
    modelId: modelId.trim(),
    promptTokens,
    completionTokens,
    totalTokens,
    ...(typeof openrouterRequestId === 'string' && openrouterRequestId.trim()
      ? { openrouterRequestId: openrouterRequestId.trim() }
      : {})
  };
}

/**
 * Helper to get user's organization ID (first one if they have multiple)
 */
async function getUserOrganizationId(userId: string): Promise<string | null> {
  const pool = await getPostgresPool();
  const result = await pool.query<{ organization_id: string }>(
    'SELECT organization_id FROM user_organizations WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return result.rows[0]?.organization_id ?? null;
}

/**
 * @openapi
 * /ai/conversations:
 *   post:
 *     summary: Create a new AI conversation
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               encryptedTitle:
 *                 type: string
 *               encryptedSessionKey:
 *                 type: string
 *               modelId:
 *                 type: string
 *             required:
 *               - encryptedTitle
 *               - encryptedSessionKey
 *     responses:
 *       201:
 *         description: Conversation created
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
export const postConversationsHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseCreateConversationPayload(req.body);
  if (!payload) {
    res.status(400).json({
      error: 'encryptedTitle and encryptedSessionKey are required'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const orgId = await getUserOrganizationId(claims.sub);
    const id = randomUUID();
    const now = new Date();

    const result = await pool.query<{
      id: string;
      user_id: string;
      organization_id: string | null;
      encrypted_title: string;
      encrypted_session_key: string;
      model_id: string | null;
      message_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `INSERT INTO ai_conversations (
        id, user_id, organization_id, encrypted_title, encrypted_session_key,
        model_id, message_count, created_at, updated_at, deleted
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7, $7, FALSE)
      RETURNING *`,
      [
        id,
        claims.sub,
        orgId,
        payload.encryptedTitle,
        payload.encryptedSessionKey,
        payload.modelId ?? null,
        now
      ]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: 'Failed to create conversation' });
      return;
    }

    const response: CreateAiConversationResponse = {
      conversation: {
        id: row.id,
        userId: row.user_id,
        organizationId: row.organization_id,
        encryptedTitle: row.encrypted_title,
        encryptedSessionKey: row.encrypted_session_key,
        modelId: row.model_id,
        messageCount: row.message_count,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      }
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to create conversation:', error);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
};

/**
 * @openapi
 * /ai/conversations:
 *   get:
 *     summary: List user's AI conversations
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: List of conversations
 *       401:
 *         description: Unauthorized
 */
export const getConversationsHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const limit = Math.min(
      Math.max(1, parseInt(String(req.query['limit']), 10) || 50),
      100
    );
    const cursor =
      typeof req.query['cursor'] === 'string' ? req.query['cursor'] : null;

    let query = `
      SELECT id, user_id, organization_id, encrypted_title, encrypted_session_key,
             model_id, message_count, created_at, updated_at
      FROM ai_conversations
      WHERE user_id = $1 AND deleted = FALSE
    `;
    const params: (string | number)[] = [claims.sub];

    if (cursor) {
      query += ` AND updated_at < $2`;
      params.push(cursor);
    }

    query += ` ORDER BY updated_at DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const result = await pool.query<{
      id: string;
      user_id: string;
      organization_id: string | null;
      encrypted_title: string;
      encrypted_session_key: string;
      model_id: string | null;
      message_count: number;
      created_at: Date;
      updated_at: Date;
    }>(query, params);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const lastRow = rows[rows.length - 1];

    const response: AiConversationsListResponse = {
      conversations: rows.map((row) => ({
        id: row.id,
        userId: row.user_id,
        organizationId: row.organization_id,
        encryptedTitle: row.encrypted_title,
        encryptedSessionKey: row.encrypted_session_key,
        modelId: row.model_id,
        messageCount: row.message_count,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      })),
      hasMore,
      ...(hasMore && lastRow
        ? { cursor: lastRow.updated_at.toISOString() }
        : {})
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to list conversations:', error);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
};

/**
 * @openapi
 * /ai/conversations/{id}:
 *   get:
 *     summary: Get a conversation with its messages
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Conversation with messages
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
export const getConversationsIdHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Conversation ID is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Get conversation
    const convResult = await pool.query<{
      id: string;
      user_id: string;
      organization_id: string | null;
      encrypted_title: string;
      encrypted_session_key: string;
      model_id: string | null;
      message_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, user_id, organization_id, encrypted_title, encrypted_session_key,
              model_id, message_count, created_at, updated_at
       FROM ai_conversations
       WHERE id = $1 AND user_id = $2 AND deleted = FALSE`,
      [id, claims.sub]
    );

    const conv = convResult.rows[0];
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Get messages
    const msgResult = await pool.query<{
      id: string;
      conversation_id: string;
      role: AiMessageRole;
      encrypted_content: string;
      model_id: string | null;
      sequence_number: number;
      created_at: Date;
    }>(
      `SELECT id, conversation_id, role, encrypted_content, model_id, sequence_number, created_at
       FROM ai_messages
       WHERE conversation_id = $1
       ORDER BY sequence_number ASC`,
      [id]
    );

    const response: AiConversationDetailResponse = {
      conversation: {
        id: conv.id,
        userId: conv.user_id,
        organizationId: conv.organization_id,
        encryptedTitle: conv.encrypted_title,
        encryptedSessionKey: conv.encrypted_session_key,
        modelId: conv.model_id,
        messageCount: conv.message_count,
        createdAt: conv.created_at.toISOString(),
        updatedAt: conv.updated_at.toISOString()
      },
      messages: msgResult.rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        role: row.role,
        encryptedContent: row.encrypted_content,
        modelId: row.model_id,
        sequenceNumber: row.sequence_number,
        createdAt: row.created_at.toISOString()
      }))
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get conversation:', error);
    res.status(500).json({ error: 'Failed to get conversation' });
  }
};

/**
 * @openapi
 * /ai/conversations/{id}:
 *   patch:
 *     summary: Update a conversation
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               encryptedTitle:
 *                 type: string
 *               modelId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Conversation updated
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
export const patchConversationsIdHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Conversation ID is required' });
    return;
  }

  const payload = parseUpdateConversationPayload(req.body);
  if (!payload) {
    res
      .status(400)
      .json({ error: 'At least encryptedTitle or modelId is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const updates: string[] = ['updated_at = NOW()'];
    const params: (string | null)[] = [];
    let paramIndex = 1;

    if (payload.encryptedTitle !== undefined) {
      updates.push(`encrypted_title = $${paramIndex}`);
      params.push(payload.encryptedTitle);
      paramIndex++;
    }

    if (payload.modelId !== undefined) {
      updates.push(`model_id = $${paramIndex}`);
      params.push(payload.modelId ?? null);
      paramIndex++;
    }

    const conversationId = Array.isArray(id) ? id[0] : id;
    const userId = claims.sub;
    if (!conversationId || !userId) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }
    params.push(conversationId);
    params.push(userId);

    const result = await pool.query<{
      id: string;
      user_id: string;
      organization_id: string | null;
      encrypted_title: string;
      encrypted_session_key: string;
      model_id: string | null;
      message_count: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE ai_conversations
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND user_id = $${paramIndex + 1} AND deleted = FALSE
       RETURNING *`,
      params
    );

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const response: AiConversationResponse = {
      conversation: {
        id: row.id,
        userId: row.user_id,
        organizationId: row.organization_id,
        encryptedTitle: row.encrypted_title,
        encryptedSessionKey: row.encrypted_session_key,
        modelId: row.model_id,
        messageCount: row.message_count,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString()
      }
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to update conversation:', error);
    res.status(500).json({ error: 'Failed to update conversation' });
  }
};

/**
 * @openapi
 * /ai/conversations/{id}:
 *   delete:
 *     summary: Soft delete a conversation
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Conversation deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
export const deleteConversationsIdHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id } = req.params;
  if (!id) {
    res.status(400).json({ error: 'Conversation ID is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    const result = await pool.query(
      `UPDATE ai_conversations
       SET deleted = TRUE, updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND deleted = FALSE`,
      [id, claims.sub]
    );

    if (result.rowCount === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete conversation:', error);
    res.status(500).json({ error: 'Failed to delete conversation' });
  }
};

/**
 * @openapi
 * /ai/conversations/{id}/messages:
 *   post:
 *     summary: Add a message to a conversation
 *     tags:
 *       - AI Conversations
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [system, user, assistant]
 *               encryptedContent:
 *                 type: string
 *               modelId:
 *                 type: string
 *             required:
 *               - role
 *               - encryptedContent
 *     responses:
 *       201:
 *         description: Message added
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Conversation not found
 */
export const postConversationsIdMessagesHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const { id: conversationId } = req.params;
  if (!conversationId) {
    res.status(400).json({ error: 'Conversation ID is required' });
    return;
  }

  const payload = parseAddMessagePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'role and encryptedContent are required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Verify conversation exists and belongs to user
    const convCheck = await pool.query<{ id: string; message_count: number }>(
      'SELECT id, message_count FROM ai_conversations WHERE id = $1 AND user_id = $2 AND deleted = FALSE',
      [conversationId, claims.sub]
    );

    if (convCheck.rows.length === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    const currentCount = convCheck.rows[0]?.message_count ?? 0;
    const messageId = randomUUID();
    const now = new Date();

    // Insert message and update conversation in a transaction
    await pool.query('BEGIN');

    try {
      const msgResult = await pool.query<{
        id: string;
        conversation_id: string;
        role: AiMessageRole;
        encrypted_content: string;
        model_id: string | null;
        sequence_number: number;
        created_at: Date;
      }>(
        `INSERT INTO ai_messages (id, conversation_id, role, encrypted_content, model_id, sequence_number, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          messageId,
          conversationId,
          payload.role,
          payload.encryptedContent,
          payload.modelId ?? null,
          currentCount + 1,
          now
        ]
      );

      const convResult = await pool.query<{
        id: string;
        user_id: string;
        organization_id: string | null;
        encrypted_title: string;
        encrypted_session_key: string;
        model_id: string | null;
        message_count: number;
        created_at: Date;
        updated_at: Date;
      }>(
        `UPDATE ai_conversations
         SET message_count = message_count + 1, updated_at = $1
         WHERE id = $2
         RETURNING *`,
        [now, conversationId]
      );

      await pool.query('COMMIT');

      const msg = msgResult.rows[0];
      const conv = convResult.rows[0];

      if (!msg || !conv) {
        res.status(500).json({ error: 'Failed to add message' });
        return;
      }

      const response: AddAiMessageResponse = {
        message: {
          id: msg.id,
          conversationId: msg.conversation_id,
          role: msg.role,
          encryptedContent: msg.encrypted_content,
          modelId: msg.model_id,
          sequenceNumber: msg.sequence_number,
          createdAt: msg.created_at.toISOString()
        },
        conversation: {
          id: conv.id,
          userId: conv.user_id,
          organizationId: conv.organization_id,
          encryptedTitle: conv.encrypted_title,
          encryptedSessionKey: conv.encrypted_session_key,
          modelId: conv.model_id,
          messageCount: conv.message_count,
          createdAt: conv.created_at.toISOString(),
          updatedAt: conv.updated_at.toISOString()
        }
      };

      res.status(201).json(response);
    } catch (e) {
      await pool.query('ROLLBACK');
      throw e;
    }
  } catch (error) {
    console.error('Failed to add message:', error);
    res.status(500).json({ error: 'Failed to add message' });
  }
};

/**
 * @openapi
 * /ai/usage:
 *   post:
 *     summary: Record AI usage
 *     tags:
 *       - AI Usage
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               conversationId:
 *                 type: string
 *               messageId:
 *                 type: string
 *               modelId:
 *                 type: string
 *               promptTokens:
 *                 type: integer
 *               completionTokens:
 *                 type: integer
 *               totalTokens:
 *                 type: integer
 *               openrouterRequestId:
 *                 type: string
 *             required:
 *               - modelId
 *               - promptTokens
 *               - completionTokens
 *               - totalTokens
 *     responses:
 *       201:
 *         description: Usage recorded
 *       400:
 *         description: Invalid request
 *       401:
 *         description: Unauthorized
 */
export const postUsageHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseRecordUsagePayload(req.body);
  if (!payload) {
    res.status(400).json({
      error:
        'modelId, promptTokens, completionTokens, and totalTokens are required'
    });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const orgId = await getUserOrganizationId(claims.sub);
    const id = randomUUID();
    const now = new Date();

    const result = await pool.query<{
      id: string;
      conversation_id: string | null;
      message_id: string | null;
      user_id: string;
      organization_id: string | null;
      model_id: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      openrouter_request_id: string | null;
      created_at: Date;
    }>(
      `INSERT INTO ai_usage (
        id, conversation_id, message_id, user_id, organization_id,
        model_id, prompt_tokens, completion_tokens, total_tokens,
        openrouter_request_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        id,
        payload.conversationId ?? null,
        payload.messageId ?? null,
        claims.sub,
        orgId,
        payload.modelId,
        payload.promptTokens,
        payload.completionTokens,
        payload.totalTokens,
        payload.openrouterRequestId ?? null,
        now
      ]
    );

    const row = result.rows[0];
    if (!row) {
      res.status(500).json({ error: 'Failed to record usage' });
      return;
    }

    const response: RecordAiUsageResponse = {
      usage: {
        id: row.id,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        userId: row.user_id,
        organizationId: row.organization_id,
        modelId: row.model_id,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        openrouterRequestId: row.openrouter_request_id,
        createdAt: row.created_at.toISOString()
      }
    };

    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to record usage:', error);
    res.status(500).json({ error: 'Failed to record usage' });
  }
};

/**
 * @openapi
 * /ai/usage:
 *   get:
 *     summary: Get AI usage history
 *     tags:
 *       - AI Usage
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: cursor
 *         schema:
 *           type: string
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Usage history
 *       401:
 *         description: Unauthorized
 */
export const getUsageHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const limit = Math.min(
      Math.max(1, parseInt(String(req.query['limit']), 10) || 50),
      100
    );
    const cursor =
      typeof req.query['cursor'] === 'string' ? req.query['cursor'] : null;
    const startDate =
      typeof req.query['startDate'] === 'string'
        ? req.query['startDate']
        : null;
    const endDate =
      typeof req.query['endDate'] === 'string' ? req.query['endDate'] : null;

    let query = `
      SELECT id, conversation_id, message_id, user_id, organization_id,
             model_id, prompt_tokens, completion_tokens, total_tokens,
             openrouter_request_id, created_at
      FROM ai_usage
      WHERE user_id = $1
    `;
    const params: (string | number)[] = [claims.sub];
    let paramIndex = 2;

    if (startDate) {
      query += ` AND created_at >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND created_at < $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    if (cursor) {
      query += ` AND created_at < $${paramIndex}`;
      params.push(cursor);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(limit + 1);

    const result = await pool.query<{
      id: string;
      conversation_id: string | null;
      message_id: string | null;
      user_id: string;
      organization_id: string | null;
      model_id: string;
      prompt_tokens: number;
      completion_tokens: number;
      total_tokens: number;
      openrouter_request_id: string | null;
      created_at: Date;
    }>(query, params);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
    const lastRow = rows[rows.length - 1];

    // Calculate summary
    const summaryResult = await pool.query<{
      total_prompt_tokens: string;
      total_completion_tokens: string;
      total_tokens: string;
      request_count: string;
      period_start: Date | null;
      period_end: Date | null;
    }>(
      `SELECT
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as request_count,
        MIN(created_at) as period_start,
        MAX(created_at) as period_end
      FROM ai_usage
      WHERE user_id = $1
        ${startDate ? `AND created_at >= $2` : ''}
        ${endDate ? `AND created_at < $${startDate ? 3 : 2}` : ''}`,
      startDate && endDate
        ? [claims.sub, startDate, endDate]
        : startDate
          ? [claims.sub, startDate]
          : endDate
            ? [claims.sub, endDate]
            : [claims.sub]
    );

    const summaryRow = summaryResult.rows[0];

    const response: AiUsageListResponse = {
      usage: rows.map((row) => ({
        id: row.id,
        conversationId: row.conversation_id,
        messageId: row.message_id,
        userId: row.user_id,
        organizationId: row.organization_id,
        modelId: row.model_id,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        totalTokens: row.total_tokens,
        openrouterRequestId: row.openrouter_request_id,
        createdAt: row.created_at.toISOString()
      })),
      summary: {
        totalPromptTokens: parseInt(summaryRow?.total_prompt_tokens ?? '0', 10),
        totalCompletionTokens: parseInt(
          summaryRow?.total_completion_tokens ?? '0',
          10
        ),
        totalTokens: parseInt(summaryRow?.total_tokens ?? '0', 10),
        requestCount: parseInt(summaryRow?.request_count ?? '0', 10),
        periodStart:
          summaryRow?.period_start?.toISOString() ?? new Date().toISOString(),
        periodEnd:
          summaryRow?.period_end?.toISOString() ?? new Date().toISOString()
      },
      hasMore,
      ...(hasMore && lastRow
        ? { cursor: lastRow.created_at.toISOString() }
        : {})
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get usage:', error);
    res.status(500).json({ error: 'Failed to get usage' });
  }
};

/**
 * @openapi
 * /ai/usage/summary:
 *   get:
 *     summary: Get AI usage summary
 *     tags:
 *       - AI Usage
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Usage summary
 *       401:
 *         description: Unauthorized
 */
export const getUsageSummaryHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const startDate =
      typeof req.query['startDate'] === 'string'
        ? req.query['startDate']
        : null;
    const endDate =
      typeof req.query['endDate'] === 'string' ? req.query['endDate'] : null;

    let whereClause = 'WHERE user_id = $1';
    const params: string[] = [claims.sub];

    if (startDate) {
      whereClause += ` AND created_at >= $${params.length + 1}`;
      params.push(startDate);
    }

    if (endDate) {
      whereClause += ` AND created_at < $${params.length + 1}`;
      params.push(endDate);
    }

    // Overall summary
    const summaryResult = await pool.query<{
      total_prompt_tokens: string;
      total_completion_tokens: string;
      total_tokens: string;
      request_count: string;
      period_start: Date | null;
      period_end: Date | null;
    }>(
      `SELECT
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as request_count,
        MIN(created_at) as period_start,
        MAX(created_at) as period_end
      FROM ai_usage
      ${whereClause}`,
      params
    );

    // Summary by model
    const byModelResult = await pool.query<{
      model_id: string;
      total_prompt_tokens: string;
      total_completion_tokens: string;
      total_tokens: string;
      request_count: string;
      period_start: Date | null;
      period_end: Date | null;
    }>(
      `SELECT
        model_id,
        COALESCE(SUM(prompt_tokens), 0) as total_prompt_tokens,
        COALESCE(SUM(completion_tokens), 0) as total_completion_tokens,
        COALESCE(SUM(total_tokens), 0) as total_tokens,
        COUNT(*) as request_count,
        MIN(created_at) as period_start,
        MAX(created_at) as period_end
      FROM ai_usage
      ${whereClause}
      GROUP BY model_id`,
      params
    );

    const summaryRow = summaryResult.rows[0];

    const byModel: Record<
      string,
      {
        totalPromptTokens: number;
        totalCompletionTokens: number;
        totalTokens: number;
        requestCount: number;
        periodStart: string;
        periodEnd: string;
      }
    > = {};

    for (const row of byModelResult.rows) {
      byModel[row.model_id] = {
        totalPromptTokens: parseInt(row.total_prompt_tokens, 10),
        totalCompletionTokens: parseInt(row.total_completion_tokens, 10),
        totalTokens: parseInt(row.total_tokens, 10),
        requestCount: parseInt(row.request_count, 10),
        periodStart:
          row.period_start?.toISOString() ?? new Date().toISOString(),
        periodEnd: row.period_end?.toISOString() ?? new Date().toISOString()
      };
    }

    const response: AiUsageSummaryResponse = {
      summary: {
        totalPromptTokens: parseInt(summaryRow?.total_prompt_tokens ?? '0', 10),
        totalCompletionTokens: parseInt(
          summaryRow?.total_completion_tokens ?? '0',
          10
        ),
        totalTokens: parseInt(summaryRow?.total_tokens ?? '0', 10),
        requestCount: parseInt(summaryRow?.request_count ?? '0', 10),
        periodStart:
          summaryRow?.period_start?.toISOString() ?? new Date().toISOString(),
        periodEnd:
          summaryRow?.period_end?.toISOString() ?? new Date().toISOString()
      },
      byModel
    };

    res.json(response);
  } catch (error) {
    console.error('Failed to get usage summary:', error);
    res.status(500).json({ error: 'Failed to get usage summary' });
  }
};

const aiConversationsRouter: RouterType = Router();
registerPostConversationsRoute(aiConversationsRouter);
registerGetConversationsRoute(aiConversationsRouter);
registerGetConversationsIdRoute(aiConversationsRouter);
registerPatchConversationsIdRoute(aiConversationsRouter);
registerDeleteConversationsIdRoute(aiConversationsRouter);
registerPostConversationsIdMessagesRoute(aiConversationsRouter);
registerPostUsageRoute(aiConversationsRouter);
registerGetUsageRoute(aiConversationsRouter);
registerGetUsageSummaryRoute(aiConversationsRouter);

export { aiConversationsRouter };
