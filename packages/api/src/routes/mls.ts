/**
 * MLS (RFC 9420) Encrypted Chat API routes.
 *
 * Handles key package management, group operations, membership, and messaging.
 * All cryptographic operations happen client-side - server only stores ciphertext.
 */

import { randomUUID } from 'node:crypto';
import type {
  AckMlsWelcomeRequest,
  AddMlsMemberRequest,
  AddMlsMemberResponse,
  CreateMlsGroupRequest,
  CreateMlsGroupResponse,
  MlsCipherSuite,
  MlsGroup,
  MlsGroupMember,
  MlsGroupMembersResponse,
  MlsGroupResponse,
  MlsGroupState,
  MlsGroupStateResponse,
  MlsGroupsResponse,
  MlsKeyPackage,
  MlsKeyPackagesResponse,
  MlsMessage,
  MlsMessagesResponse,
  MlsMessageType,
  MlsWelcomeMessage,
  MlsWelcomeMessagesResponse,
  RemoveMlsMemberRequest,
  SendMlsMessageRequest,
  SendMlsMessageResponse,
  UpdateMlsGroupRequest,
  UploadMlsKeyPackagesRequest,
  UploadMlsKeyPackagesResponse,
  UploadMlsStateRequest,
  UploadMlsStateResponse
} from '@rapid/shared';
import { isRecord, MLS_CIPHERSUITES } from '@rapid/shared';
import {
  type Request,
  type Response,
  Router,
  type Router as RouterType
} from 'express';
import { broadcast } from '../lib/broadcast.js';
import { getPostgresPool } from '../lib/postgres.js';
import { registerDeleteGroupsGroupidRoute } from './mls/delete-groups-groupId.js';
import { registerDeleteGroupsGroupidMembersUseridRoute } from './mls/delete-groups-groupId-members-userId.js';
import { registerDeleteKeyPackagesIdRoute } from './mls/delete-key-packages-id.js';
import { registerGetGroupsRoute } from './mls/get-groups.js';
import { registerGetGroupsGroupidRoute } from './mls/get-groups-groupId.js';
import { registerGetGroupsGroupidMembersRoute } from './mls/get-groups-groupId-members.js';
import { registerGetGroupsGroupidMessagesRoute } from './mls/get-groups-groupId-messages.js';
import { registerGetGroupsGroupidStateRoute } from './mls/get-groups-groupId-state.js';
import { registerGetKeyPackagesMeRoute } from './mls/get-key-packages-me.js';
import { registerGetKeyPackagesUseridRoute } from './mls/get-key-packages-userId.js';
import { registerGetWelcomeMessagesRoute } from './mls/get-welcome-messages.js';
import { registerPatchGroupsGroupidRoute } from './mls/patch-groups-groupId.js';
import { registerPostGroupsRoute } from './mls/post-groups.js';
import { registerPostGroupsGroupidMembersRoute } from './mls/post-groups-groupId-members.js';
import { registerPostGroupsGroupidMessagesRoute } from './mls/post-groups-groupId-messages.js';
import { registerPostGroupsGroupidStateRoute } from './mls/post-groups-groupId-state.js';
import { registerPostKeyPackagesRoute } from './mls/post-key-packages.js';
import { registerPostWelcomeMessagesIdAckRoute } from './mls/post-welcome-messages-id-ack.js';

// =============================================================================
// Validation helpers
// =============================================================================

function isValidCipherSuite(value: unknown): value is MlsCipherSuite {
  return (
    typeof value === 'number' &&
    Object.values(MLS_CIPHERSUITES).includes(value as MlsCipherSuite)
  );
}

function toSafeCipherSuite(value: unknown): MlsCipherSuite {
  return isValidCipherSuite(value)
    ? value
    : MLS_CIPHERSUITES.X25519_CHACHA20_SHA256_ED25519;
}

function isValidMessageType(value: unknown): value is MlsMessageType {
  return (
    typeof value === 'string' &&
    ['application', 'commit', 'proposal'].includes(value)
  );
}

function parseUploadKeyPackagesPayload(
  body: unknown
): UploadMlsKeyPackagesRequest | null {
  if (!isRecord(body)) return null;
  const keyPackages = body['keyPackages'];
  if (!Array.isArray(keyPackages)) return null;

  const parsed: UploadMlsKeyPackagesRequest['keyPackages'] = [];
  for (const kp of keyPackages) {
    if (!isRecord(kp)) return null;
    const keyPackageData = kp['keyPackageData'];
    const keyPackageRef = kp['keyPackageRef'];
    const cipherSuite = kp['cipherSuite'];

    if (
      typeof keyPackageData !== 'string' ||
      typeof keyPackageRef !== 'string' ||
      !isValidCipherSuite(cipherSuite)
    ) {
      return null;
    }

    if (!keyPackageData.trim() || !keyPackageRef.trim()) return null;

    parsed.push({
      keyPackageData: keyPackageData.trim(),
      keyPackageRef: keyPackageRef.trim(),
      cipherSuite
    });
  }

  if (parsed.length === 0) return null;
  return { keyPackages: parsed };
}

function parseCreateGroupPayload(body: unknown): CreateMlsGroupRequest | null {
  if (!isRecord(body)) return null;
  const name = body['name'];
  const description = body['description'];
  const groupIdMls = body['groupIdMls'];
  const cipherSuite = body['cipherSuite'];

  if (
    typeof name !== 'string' ||
    typeof groupIdMls !== 'string' ||
    !isValidCipherSuite(cipherSuite)
  ) {
    return null;
  }

  if (!name.trim() || !groupIdMls.trim()) return null;

  const result: CreateMlsGroupRequest = {
    name: name.trim(),
    groupIdMls: groupIdMls.trim(),
    cipherSuite
  };
  if (typeof description === 'string' && description.trim()) {
    result.description = description.trim();
  }
  return result;
}

function parseUpdateGroupPayload(body: unknown): UpdateMlsGroupRequest | null {
  if (!isRecord(body)) return null;
  const name = body['name'];
  const description = body['description'];

  const result: UpdateMlsGroupRequest = {};
  if (typeof name === 'string') result.name = name.trim();
  if (typeof description === 'string') result.description = description.trim();

  if (Object.keys(result).length === 0) return null;
  return result;
}

function parseAddMemberPayload(body: unknown): AddMlsMemberRequest | null {
  if (!isRecord(body)) return null;
  const userId = body['userId'];
  const commit = body['commit'];
  const welcome = body['welcome'];
  const keyPackageRef = body['keyPackageRef'];
  const newEpoch = body['newEpoch'];

  if (
    typeof userId !== 'string' ||
    typeof commit !== 'string' ||
    typeof welcome !== 'string' ||
    typeof keyPackageRef !== 'string' ||
    typeof newEpoch !== 'number'
  ) {
    return null;
  }

  if (
    !userId.trim() ||
    !commit.trim() ||
    !welcome.trim() ||
    !keyPackageRef.trim()
  ) {
    return null;
  }

  return {
    userId: userId.trim(),
    commit: commit.trim(),
    welcome: welcome.trim(),
    keyPackageRef: keyPackageRef.trim(),
    newEpoch
  };
}

function parseRemoveMemberPayload(
  body: unknown
): RemoveMlsMemberRequest | null {
  if (!isRecord(body)) return null;
  const commit = body['commit'];
  const newEpoch = body['newEpoch'];

  if (typeof commit !== 'string' || typeof newEpoch !== 'number') {
    return null;
  }

  if (!commit.trim()) return null;

  return {
    commit: commit.trim(),
    newEpoch
  };
}

function parseSendMessagePayload(body: unknown): SendMlsMessageRequest | null {
  if (!isRecord(body)) return null;
  const ciphertext = body['ciphertext'];
  const epoch = body['epoch'];
  const messageType = body['messageType'];
  const contentType = body['contentType'];

  if (
    typeof ciphertext !== 'string' ||
    typeof epoch !== 'number' ||
    !isValidMessageType(messageType)
  ) {
    return null;
  }

  if (!ciphertext.trim()) return null;

  const result: SendMlsMessageRequest = {
    ciphertext: ciphertext.trim(),
    epoch,
    messageType
  };
  if (typeof contentType === 'string' && contentType.trim()) {
    result.contentType = contentType.trim();
  }
  return result;
}

function parseUploadStatePayload(body: unknown): UploadMlsStateRequest | null {
  if (!isRecord(body)) return null;
  const epoch = body['epoch'];
  const encryptedState = body['encryptedState'];
  const stateHash = body['stateHash'];

  if (
    typeof epoch !== 'number' ||
    typeof encryptedState !== 'string' ||
    typeof stateHash !== 'string'
  ) {
    return null;
  }

  if (!encryptedState.trim() || !stateHash.trim()) return null;

  return {
    epoch,
    encryptedState: encryptedState.trim(),
    stateHash: stateHash.trim()
  };
}

function parseAckWelcomePayload(body: unknown): AckMlsWelcomeRequest | null {
  if (!isRecord(body)) return null;
  const groupId = body['groupId'];

  if (typeof groupId !== 'string' || !groupId.trim()) return null;

  return { groupId: groupId.trim() };
}

// =============================================================================
// Key Package Endpoints
// =============================================================================

/**
 * @openapi
 * /mls/key-packages:
 *   post:
 *     summary: Upload MLS key packages
 *     description: Upload one or more key packages for the current user. Others can use these to add the user to groups.
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               keyPackages:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     keyPackageData:
 *                       type: string
 *                     keyPackageRef:
 *                       type: string
 *                     cipherSuite:
 *                       type: integer
 *     responses:
 *       201:
 *         description: Key packages uploaded successfully
 *       400:
 *         description: Invalid request payload
 *       401:
 *         description: Unauthorized
 */
export const postKeyPackagesHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseUploadKeyPackagesPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid key packages payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const uploadedPackages: MlsKeyPackage[] = [];

    for (const kp of payload.keyPackages) {
      const id = randomUUID();
      const result = await pool.query<{ created_at: Date }>(
        `INSERT INTO mls_key_packages (
          id, user_id, key_package_data, key_package_ref, cipher_suite, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (key_package_ref) DO NOTHING
        RETURNING created_at`,
        [id, claims.sub, kp.keyPackageData, kp.keyPackageRef, kp.cipherSuite]
      );

      if (result.rows[0]) {
        uploadedPackages.push({
          id,
          userId: claims.sub,
          keyPackageData: kp.keyPackageData,
          keyPackageRef: kp.keyPackageRef,
          cipherSuite: kp.cipherSuite,
          createdAt: result.rows[0].created_at.toISOString(),
          consumed: false
        });
      }
    }

    const response: UploadMlsKeyPackagesResponse = {
      keyPackages: uploadedPackages
    };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to upload key packages:', error);
    res.status(500).json({ error: 'Failed to upload key packages' });
  }
};

/**
 * @openapi
 * /mls/key-packages/me:
 *   get:
 *     summary: Get current user's key packages
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: User's key packages
 */
export const getKeyPackagesMeHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      key_package_data: string;
      key_package_ref: string;
      cipher_suite: number;
      created_at: Date;
      consumed_at: Date | null;
    }>(
      `SELECT id, key_package_data, key_package_ref, cipher_suite, created_at, consumed_at
       FROM mls_key_packages
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [claims.sub]
    );

    const keyPackages: MlsKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId: claims.sub,
      keyPackageData: row.key_package_data,
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      consumed: row.consumed_at !== null
    }));

    const response: MlsKeyPackagesResponse = { keyPackages };
    res.json(response);
  } catch (error) {
    console.error('Failed to get key packages:', error);
    res.status(500).json({ error: 'Failed to get key packages' });
  }
};

/**
 * @openapi
 * /mls/key-packages/{userId}:
 *   get:
 *     summary: Get available key packages for a user
 *     description: Get unconsumed key packages for a user (to add them to a group)
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Available key packages
 */
export const getKeyPackagesUseridHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const userIdParam = req.params['userId'];
  if (!userIdParam || typeof userIdParam !== 'string') {
    res.status(400).json({ error: 'userId is required' });
    return;
  }
  const userId = userIdParam;

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      key_package_data: string;
      key_package_ref: string;
      cipher_suite: number;
      created_at: Date;
    }>(
      `SELECT id, key_package_data, key_package_ref, cipher_suite, created_at
       FROM mls_key_packages
       WHERE user_id = $1 AND consumed_at IS NULL
       ORDER BY created_at ASC
       LIMIT 10`,
      [userId]
    );

    const keyPackages: MlsKeyPackage[] = result.rows.map((row) => ({
      id: row.id,
      userId,
      keyPackageData: row.key_package_data,
      keyPackageRef: row.key_package_ref,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      consumed: false
    }));

    const response: MlsKeyPackagesResponse = { keyPackages };
    res.json(response);
  } catch (error) {
    console.error('Failed to get key packages:', error);
    res.status(500).json({ error: 'Failed to get key packages' });
  }
};

/**
 * @openapi
 * /mls/key-packages/{id}:
 *   delete:
 *     summary: Delete an unused key package
 *     tags:
 *       - MLS
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
 *         description: Key package deleted
 */
export const deleteKeyPackagesIdHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const idParam = req.params['id'];
  if (!idParam || typeof idParam !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const id = idParam;

  try {
    const pool = await getPostgresPool();
    const result = await pool.query(
      `DELETE FROM mls_key_packages
       WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL`,
      [id, claims.sub]
    );

    if (result.rowCount === 0) {
      res
        .status(404)
        .json({ error: 'Key package not found or already consumed' });
      return;
    }

    res.status(204).send();
  } catch (error) {
    console.error('Failed to delete key package:', error);
    res.status(500).json({ error: 'Failed to delete key package' });
  }
};

// =============================================================================
// Group Endpoints
// =============================================================================

/**
 * @openapi
 * /mls/groups:
 *   post:
 *     summary: Create a new MLS group
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Group created
 */
export const postGroupsHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const payload = parseCreateGroupPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid group payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const id = randomUUID();
    const now = new Date();

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Create group
      await client.query(
        `INSERT INTO mls_groups (
          id, group_id_mls, name, description, creator_user_id,
          current_epoch, cipher_suite, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $7)`,
        [
          id,
          payload.groupIdMls,
          payload.name,
          payload.description ?? null,
          claims.sub,
          payload.cipherSuite,
          now
        ]
      );

      // Add creator as admin member
      await client.query(
        `INSERT INTO mls_group_members (
          group_id, user_id, leaf_index, role, joined_at, joined_at_epoch
        ) VALUES ($1, $2, 0, 'admin', $3, 0)`,
        [id, claims.sub, now]
      );

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }

    const group: MlsGroup = {
      id,
      groupIdMls: payload.groupIdMls,
      name: payload.name,
      description: payload.description ?? null,
      creatorUserId: claims.sub,
      currentEpoch: 0,
      cipherSuite: payload.cipherSuite,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      memberCount: 1,
      role: 'admin'
    };

    const response: CreateMlsGroupResponse = { group };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to create group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
};

/**
 * @openapi
 * /mls/groups:
 *   get:
 *     summary: List user's MLS groups
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of groups
 */
export const getGroupsHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      group_id_mls: string;
      name: string;
      description: string | null;
      creator_user_id: string;
      current_epoch: number;
      cipher_suite: number;
      created_at: Date;
      updated_at: Date;
      role: string;
      member_count: string;
    }>(
      `SELECT g.id, g.group_id_mls, g.name, g.description, g.creator_user_id,
              g.current_epoch, g.cipher_suite, g.created_at, g.updated_at,
              m.role,
              (SELECT COUNT(*) FROM mls_group_members WHERE group_id = g.id AND removed_at IS NULL)::text as member_count
       FROM mls_groups g
       JOIN mls_group_members m ON g.id = m.group_id
       WHERE m.user_id = $1 AND m.removed_at IS NULL
       ORDER BY g.updated_at DESC`,
      [claims.sub]
    );

    const groups: MlsGroup[] = result.rows.map((row) => ({
      id: row.id,
      groupIdMls: row.group_id_mls,
      name: row.name,
      description: row.description,
      creatorUserId: row.creator_user_id,
      currentEpoch: row.current_epoch,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      memberCount: parseInt(row.member_count, 10),
      role: row.role as 'admin' | 'member'
    }));

    const response: MlsGroupsResponse = { groups };
    res.json(response);
  } catch (error) {
    console.error('Failed to list groups:', error);
    res.status(500).json({ error: 'Failed to list groups' });
  }
};

/**
 * @openapi
 * /mls/groups/{groupId}:
 *   get:
 *     summary: Get MLS group details
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group details with members
 */
export const getGroupsGroupidHandler = async (req: Request, res: Response) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT role FROM mls_group_members
       WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Get group
    const groupResult = await pool.query<{
      id: string;
      group_id_mls: string;
      name: string;
      description: string | null;
      creator_user_id: string;
      current_epoch: number;
      cipher_suite: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, group_id_mls, name, description, creator_user_id,
              current_epoch, cipher_suite, created_at, updated_at
       FROM mls_groups WHERE id = $1`,
      [groupId]
    );

    if (groupResult.rows.length === 0) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const row = groupResult.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    // Get members
    const membersResult = await pool.query<{
      user_id: string;
      email: string;
      leaf_index: number | null;
      role: string;
      joined_at: Date;
      joined_at_epoch: number;
    }>(
      `SELECT m.user_id, u.email, m.leaf_index, m.role, m.joined_at, m.joined_at_epoch
       FROM mls_group_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.group_id = $1 AND m.removed_at IS NULL
       ORDER BY m.joined_at ASC`,
      [groupId]
    );

    const group: MlsGroup = {
      id: row.id,
      groupIdMls: row.group_id_mls,
      name: row.name,
      description: row.description,
      creatorUserId: row.creator_user_id,
      currentEpoch: row.current_epoch,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };

    const members: MlsGroupMember[] = membersResult.rows.map((m) => ({
      userId: m.user_id,
      email: m.email,
      leafIndex: m.leaf_index,
      role: m.role as 'admin' | 'member',
      joinedAt: m.joined_at.toISOString(),
      joinedAtEpoch: m.joined_at_epoch
    }));

    const response: MlsGroupResponse = { group, members };
    res.json(response);
  } catch (error) {
    console.error('Failed to get group:', error);
    res.status(500).json({ error: 'Failed to get group' });
  }
};

/**
 * @openapi
 * /mls/groups/{groupId}:
 *   patch:
 *     summary: Update MLS group metadata
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Group updated
 */
export const patchGroupsGroupidHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  const payload = parseUpdateGroupPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'At least one field to update is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Check admin membership
    const memberCheck = await pool.query(
      `SELECT role FROM mls_group_members
       WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const role = memberCheck.rows[0]?.role;
    if (role !== 'admin') {
      res.status(403).json({ error: 'Only admins can update group' });
      return;
    }

    // Build update query
    const updates: string[] = ['updated_at = NOW()'];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (payload.name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(payload.name);
    }
    if (payload.description !== undefined) {
      updates.push(`description = $${paramIndex++}`);
      values.push(payload.description);
    }

    values.push(groupId);

    const result = await pool.query<{
      id: string;
      group_id_mls: string;
      name: string;
      description: string | null;
      creator_user_id: string;
      current_epoch: number;
      cipher_suite: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE mls_groups SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, group_id_mls, name, description, creator_user_id,
                 current_epoch, cipher_suite, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const row = result.rows[0];
    if (!row) {
      res.status(404).json({ error: 'Group not found' });
      return;
    }

    const group: MlsGroup = {
      id: row.id,
      groupIdMls: row.group_id_mls,
      name: row.name,
      description: row.description,
      creatorUserId: row.creator_user_id,
      currentEpoch: row.current_epoch,
      cipherSuite: toSafeCipherSuite(row.cipher_suite),
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };

    res.json({ group });
  } catch (error) {
    console.error('Failed to update group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
};

/**
 * @openapi
 * /mls/groups/{groupId}:
 *   delete:
 *     summary: Leave or delete MLS group
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Left/deleted group
 */
export const deleteGroupsGroupidHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query<{ role: string }>(
      `SELECT role FROM mls_group_members
       WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Mark as removed
    await pool.query(
      `UPDATE mls_group_members SET removed_at = NOW()
       WHERE group_id = $1 AND user_id = $2`,
      [groupId, claims.sub]
    );

    res.status(204).send();
  } catch (error) {
    console.error('Failed to leave group:', error);
    res.status(500).json({ error: 'Failed to leave group' });
  }
};

// =============================================================================
// Membership Endpoints
// =============================================================================

/**
 * @openapi
 * /mls/groups/{groupId}/members:
 *   post:
 *     summary: Add member to MLS group
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Member added
 */
export const postGroupsGroupidMembersHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  const payload = parseAddMemberPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid add member payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Check admin membership
    const memberCheck = await pool.query<{ role: string }>(
      `SELECT role FROM mls_group_members
       WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const role = memberCheck.rows[0]?.role;
    if (role !== 'admin') {
      res.status(403).json({ error: 'Only admins can add members' });
      return;
    }

    const client = await pool.connect();
    let welcomeId = '';
    let leafIndex = 0;
    const now = new Date();

    try {
      await client.query('BEGIN');

      // Get current member count for leaf index
      const countResult = await client.query<{ count: string }>(
        `SELECT COUNT(*) as count FROM mls_group_members WHERE group_id = $1`,
        [groupId]
      );
      leafIndex = parseInt(countResult.rows[0]?.count ?? '0', 10);

      // Add member
      await client.query(
        `INSERT INTO mls_group_members (
          group_id, user_id, leaf_index, role, joined_at, joined_at_epoch
        ) VALUES ($1, $2, $3, 'member', $4, $5)`,
        [groupId, payload.userId, leafIndex, now, payload.newEpoch]
      );

      // Mark key package as consumed
      await client.query(
        `UPDATE mls_key_packages SET consumed_at = NOW(), consumed_by_group_id = $1
         WHERE key_package_ref = $2`,
        [groupId, payload.keyPackageRef]
      );

      // Store welcome message
      welcomeId = randomUUID();
      await client.query(
        `INSERT INTO mls_welcome_messages (
          id, group_id, recipient_user_id, key_package_ref, welcome_data, epoch, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          welcomeId,
          groupId,
          payload.userId,
          payload.keyPackageRef,
          payload.welcome,
          payload.newEpoch
        ]
      );

      // Store commit as message with atomic sequence number generation
      const commitId = randomUUID();
      await client.query(
        `INSERT INTO mls_messages (
          id, group_id, sender_user_id, epoch, ciphertext, message_type, sequence_number, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, 'commit',
          COALESCE((SELECT MAX(sequence_number) FROM mls_messages WHERE group_id = $2), 0) + 1,
          NOW()
        )`,
        [commitId, groupId, claims.sub, payload.newEpoch, payload.commit]
      );

      // Update group epoch
      await client.query(
        `UPDATE mls_groups SET current_epoch = $1, updated_at = NOW() WHERE id = $2`,
        [payload.newEpoch, groupId]
      );

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }

    // Get member email
    const userResult = await pool.query<{ email: string }>(
      `SELECT email FROM users WHERE id = $1`,
      [payload.userId]
    );

    const member: MlsGroupMember = {
      userId: payload.userId,
      email: userResult.rows[0]?.email ?? '',
      leafIndex,
      role: 'member',
      joinedAt: now.toISOString(),
      joinedAtEpoch: payload.newEpoch
    };

    // Broadcast to group channel
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:member_added',
      payload: { groupId, member },
      timestamp: now.toISOString()
    });

    // Notify new member
    await broadcast(`mls:user:${payload.userId}`, {
      type: 'mls:welcome',
      payload: { groupId, welcomeId },
      timestamp: now.toISOString()
    });

    const response: AddMlsMemberResponse = { member };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to add member:', error);
    res.status(500).json({ error: 'Failed to add member' });
  }
};

/**
 * @openapi
 * /mls/groups/{groupId}/members:
 *   get:
 *     summary: List MLS group members
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: List of members
 */
export const getGroupsGroupidMembersHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM mls_group_members
       WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const result = await pool.query<{
      user_id: string;
      email: string;
      leaf_index: number | null;
      role: string;
      joined_at: Date;
      joined_at_epoch: number;
    }>(
      `SELECT m.user_id, u.email, m.leaf_index, m.role, m.joined_at, m.joined_at_epoch
       FROM mls_group_members m
       JOIN users u ON m.user_id = u.id
       WHERE m.group_id = $1 AND m.removed_at IS NULL
       ORDER BY m.joined_at ASC`,
      [groupId]
    );

    const members: MlsGroupMember[] = result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      leafIndex: row.leaf_index,
      role: row.role as 'admin' | 'member',
      joinedAt: row.joined_at.toISOString(),
      joinedAtEpoch: row.joined_at_epoch
    }));

    const response: MlsGroupMembersResponse = { members };
    res.json(response);
  } catch (error) {
    console.error('Failed to list members:', error);
    res.status(500).json({ error: 'Failed to list members' });
  }
};

/**
 * @openapi
 * /mls/groups/{groupId}/members/{userId}:
 *   delete:
 *     summary: Remove member from MLS group
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       204:
 *         description: Member removed
 */
export const deleteGroupsGroupidMembersUseridHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  const userIdParam = req.params['userId'];
  if (
    !groupIdParam ||
    typeof groupIdParam !== 'string' ||
    !userIdParam ||
    typeof userIdParam !== 'string'
  ) {
    res.status(400).json({ error: 'groupId and userId are required' });
    return;
  }
  const groupId = groupIdParam;
  const userId = userIdParam;

  const payload = parseRemoveMemberPayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid remove member payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Check admin membership
    const memberCheck = await pool.query<{ role: string }>(
      `SELECT role FROM mls_group_members
         WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const role = memberCheck.rows[0]?.role;
    if (role !== 'admin') {
      res.status(403).json({ error: 'Only admins can remove members' });
      return;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Mark as removed
      const result = await client.query(
        `UPDATE mls_group_members SET removed_at = NOW()
           WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
        [groupId, userId]
      );

      if (result.rowCount === 0) {
        await client.query('ROLLBACK');
        res.status(404).json({ error: 'Member not found' });
        return;
      }

      // Store commit with atomic sequence number generation
      const commitId = randomUUID();
      await client.query(
        `INSERT INTO mls_messages (
            id, group_id, sender_user_id, epoch, ciphertext, message_type, sequence_number, created_at
          ) VALUES (
            $1, $2, $3, $4, $5, 'commit',
            COALESCE((SELECT MAX(sequence_number) FROM mls_messages WHERE group_id = $2), 0) + 1,
            NOW()
          )`,
        [commitId, groupId, claims.sub, payload.newEpoch, payload.commit]
      );

      // Update group epoch
      await client.query(
        `UPDATE mls_groups SET current_epoch = $1, updated_at = NOW() WHERE id = $2`,
        [payload.newEpoch, groupId]
      );

      await client.query('COMMIT');
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Ignore rollback errors
      }
      throw error;
    } finally {
      client.release();
    }

    // Broadcast to group
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:member_removed',
      payload: { groupId, userId },
      timestamp: new Date().toISOString()
    });

    res.status(204).send();
  } catch (error) {
    console.error('Failed to remove member:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
};

// =============================================================================
// Message Endpoints
// =============================================================================

/**
 * @openapi
 * /mls/groups/{groupId}/messages:
 *   post:
 *     summary: Send encrypted message to MLS group
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: Message sent
 */
export const postGroupsGroupidMessagesHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  const payload = parseSendMessagePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid message payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM mls_group_members
         WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Insert message with atomic sequence number assignment
    // Uses subquery to avoid race condition on concurrent inserts
    const id = randomUUID();
    const result = await pool.query<{
      sequence_number: number;
      created_at: Date;
    }>(
      `INSERT INTO mls_messages (
          id, group_id, sender_user_id, epoch, ciphertext, message_type, content_type, sequence_number, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          COALESCE((SELECT MAX(sequence_number) FROM mls_messages WHERE group_id = $2), 0) + 1,
          NOW()
        )
        RETURNING sequence_number, created_at`,
      [
        id,
        groupId,
        claims.sub,
        payload.epoch,
        payload.ciphertext,
        payload.messageType,
        payload.contentType ?? 'text/plain'
      ]
    );

    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to insert message');
    }

    const message: MlsMessage = {
      id,
      groupId,
      senderUserId: claims.sub,
      epoch: payload.epoch,
      ciphertext: payload.ciphertext,
      messageType: payload.messageType,
      contentType: payload.contentType ?? 'text/plain',
      sequenceNumber: row.sequence_number,
      sentAt: row.created_at.toISOString(),
      createdAt: row.created_at.toISOString()
    };

    // Broadcast to group channel
    await broadcast(`mls:group:${groupId}`, {
      type: 'mls:message',
      payload: message,
      timestamp: row.created_at.toISOString()
    });

    const response: SendMlsMessageResponse = { message };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to send message:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
};

/**
 * @openapi
 * /mls/groups/{groupId}/messages:
 *   get:
 *     summary: Get message history for MLS group
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
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
 *         description: Message history
 */
export const getGroupsGroupidMessagesHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  const cursor = req.query['cursor'] as string | undefined;
  const limit = Math.min(parseInt(req.query['limit'] as string, 10) || 50, 100);

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM mls_group_members
         WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Get messages with sender email
    let query = `SELECT m.id, m.group_id, m.sender_user_id, m.epoch, m.ciphertext,
                          m.message_type, m.content_type, m.sequence_number, m.created_at,
                          u.email as sender_email
                   FROM mls_messages m
                   LEFT JOIN users u ON u.id = m.sender_user_id
                   WHERE m.group_id = $1`;
    const params: unknown[] = [groupId];

    if (cursor) {
      query += ` AND m.sequence_number < $2`;
      params.push(parseInt(cursor, 10));
    }

    query += ` ORDER BY m.sequence_number DESC LIMIT $${params.length + 1}`;
    params.push(limit + 1);

    const result = await pool.query<{
      id: string;
      group_id: string;
      sender_user_id: string;
      epoch: number;
      ciphertext: string;
      message_type: string;
      content_type: string;
      sequence_number: number;
      created_at: Date;
      sender_email: string | null;
    }>(query, params);

    const hasMore = result.rows.length > limit;
    const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

    const messages: MlsMessage[] = rows.map((row) => {
      const createdAtStr = row.created_at.toISOString();
      const msg: MlsMessage = {
        id: row.id,
        groupId: row.group_id,
        senderUserId: row.sender_user_id,
        epoch: row.epoch,
        ciphertext: row.ciphertext,
        messageType: row.message_type as MlsMessageType,
        contentType: row.content_type,
        sequenceNumber: row.sequence_number,
        sentAt: createdAtStr,
        createdAt: createdAtStr
      };
      if (row.sender_email) {
        msg.senderEmail = row.sender_email;
      }
      return msg;
    });

    const response: MlsMessagesResponse = {
      messages: messages.reverse(), // Return in chronological order
      hasMore
    };
    if (hasMore && rows.length > 0) {
      const lastRow = rows[rows.length - 1];
      if (lastRow) {
        response.cursor = String(lastRow.sequence_number);
      }
    }

    res.json(response);
  } catch (error) {
    console.error('Failed to get messages:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
};

// =============================================================================
// Welcome Message Endpoints
// =============================================================================

/**
 * @openapi
 * /mls/welcome-messages:
 *   get:
 *     summary: Get pending welcome messages for current user
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Pending welcome messages
 */
export const getWelcomeMessagesHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query<{
      id: string;
      group_id: string;
      group_name: string;
      welcome_data: string;
      key_package_ref: string;
      epoch: number;
      created_at: Date;
    }>(
      `SELECT w.id, w.group_id, g.name as group_name, w.welcome_data, w.key_package_ref,
              w.epoch, w.created_at
       FROM mls_welcome_messages w
       JOIN mls_groups g ON w.group_id = g.id
       WHERE w.recipient_user_id = $1 AND w.consumed_at IS NULL
       ORDER BY w.created_at DESC`,
      [claims.sub]
    );

    const welcomes: MlsWelcomeMessage[] = result.rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      groupName: row.group_name,
      welcome: row.welcome_data,
      keyPackageRef: row.key_package_ref,
      epoch: row.epoch,
      createdAt: row.created_at.toISOString()
    }));

    const response: MlsWelcomeMessagesResponse = { welcomes };
    res.json(response);
  } catch (error) {
    console.error('Failed to get welcome messages:', error);
    res.status(500).json({ error: 'Failed to get welcome messages' });
  }
};

/**
 * @openapi
 * /mls/welcome-messages/{id}/ack:
 *   post:
 *     summary: Acknowledge welcome message (mark as consumed)
 *     tags:
 *       - MLS
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
 *         description: Welcome acknowledged
 */
export const postWelcomeMessagesIdAckHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const idParam = req.params['id'];
  if (!idParam || typeof idParam !== 'string') {
    res.status(400).json({ error: 'id is required' });
    return;
  }
  const id = idParam;

  const payload = parseAckWelcomePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }

  try {
    const pool = await getPostgresPool();
    const result = await pool.query(
      `UPDATE mls_welcome_messages SET consumed_at = NOW()
       WHERE id = $1 AND recipient_user_id = $2 AND consumed_at IS NULL`,
      [id, claims.sub]
    );

    if (result.rowCount === 0) {
      res
        .status(404)
        .json({ error: 'Welcome message not found or already acknowledged' });
      return;
    }

    res.json({ acknowledged: true });
  } catch (error) {
    console.error('Failed to acknowledge welcome:', error);
    res.status(500).json({ error: 'Failed to acknowledge welcome' });
  }
};

// =============================================================================
// State Management Endpoints (Multi-device sync)
// =============================================================================

/**
 * @openapi
 * /mls/groups/{groupId}/state:
 *   post:
 *     summary: Upload encrypted MLS state snapshot
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       201:
 *         description: State uploaded
 */
export const postGroupsGroupidStateHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  const payload = parseUploadStatePayload(req.body);
  if (!payload) {
    res.status(400).json({ error: 'Invalid state payload' });
    return;
  }

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM mls_group_members
       WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    // Upsert state (replace if same epoch or older)
    const id = randomUUID();
    const result = await pool.query<{ id: string; created_at: Date }>(
      `INSERT INTO mls_group_state (
        id, group_id, user_id, epoch, encrypted_state, state_hash, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
      ON CONFLICT (group_id, user_id) DO UPDATE SET
        id = EXCLUDED.id,
        epoch = EXCLUDED.epoch,
        encrypted_state = EXCLUDED.encrypted_state,
        state_hash = EXCLUDED.state_hash,
        created_at = NOW()
      WHERE mls_group_state.epoch <= EXCLUDED.epoch
      RETURNING id, created_at`,
      [
        id,
        groupId,
        claims.sub,
        payload.epoch,
        payload.encryptedState,
        payload.stateHash
      ]
    );

    if (result.rows.length === 0) {
      res
        .status(409)
        .json({ error: 'State with a newer epoch already exists' });
      return;
    }

    const state: MlsGroupState = {
      id,
      groupId,
      epoch: payload.epoch,
      encryptedState: payload.encryptedState,
      stateHash: payload.stateHash,
      createdAt: new Date().toISOString()
    };

    const response: UploadMlsStateResponse = { state };
    res.status(201).json(response);
  } catch (error) {
    console.error('Failed to upload state:', error);
    res.status(500).json({ error: 'Failed to upload state' });
  }
};

/**
 * @openapi
 * /mls/groups/{groupId}/state:
 *   get:
 *     summary: Get latest MLS state snapshot for recovery
 *     tags:
 *       - MLS
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: groupId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Latest state snapshot
 */
export const getGroupsGroupidStateHandler = async (
  req: Request,
  res: Response
) => {
  const claims = req.authClaims;
  if (!claims) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const groupIdParam = req.params['groupId'];
  if (!groupIdParam || typeof groupIdParam !== 'string') {
    res.status(400).json({ error: 'groupId is required' });
    return;
  }
  const groupId = groupIdParam;

  try {
    const pool = await getPostgresPool();

    // Check membership
    const memberCheck = await pool.query(
      `SELECT 1 FROM mls_group_members
       WHERE group_id = $1 AND user_id = $2 AND removed_at IS NULL`,
      [groupId, claims.sub]
    );

    if (memberCheck.rows.length === 0) {
      res.status(403).json({ error: 'Not a member of this group' });
      return;
    }

    const result = await pool.query<{
      id: string;
      group_id: string;
      epoch: number;
      encrypted_state: string;
      state_hash: string;
      created_at: Date;
    }>(
      `SELECT id, group_id, epoch, encrypted_state, state_hash, created_at
       FROM mls_group_state
       WHERE group_id = $1 AND user_id = $2
       ORDER BY epoch DESC
       LIMIT 1`,
      [groupId, claims.sub]
    );

    if (result.rows.length === 0) {
      const response: MlsGroupStateResponse = { state: null };
      res.json(response);
      return;
    }

    const row = result.rows[0];
    if (!row) {
      const response: MlsGroupStateResponse = { state: null };
      res.json(response);
      return;
    }

    const state: MlsGroupState = {
      id: row.id,
      groupId: row.group_id,
      epoch: row.epoch,
      encryptedState: row.encrypted_state,
      stateHash: row.state_hash,
      createdAt: row.created_at.toISOString()
    };

    const response: MlsGroupStateResponse = { state };
    res.json(response);
  } catch (error) {
    console.error('Failed to get state:', error);
    res.status(500).json({ error: 'Failed to get state' });
  }
};

const router: RouterType = Router();
registerPostKeyPackagesRoute(router);
registerGetKeyPackagesMeRoute(router);
registerGetKeyPackagesUseridRoute(router);
registerDeleteKeyPackagesIdRoute(router);
registerPostGroupsRoute(router);
registerGetGroupsRoute(router);
registerGetGroupsGroupidRoute(router);
registerPatchGroupsGroupidRoute(router);
registerDeleteGroupsGroupidRoute(router);
registerPostGroupsGroupidMembersRoute(router);
registerGetGroupsGroupidMembersRoute(router);
registerDeleteGroupsGroupidMembersUseridRoute(router);
registerPostGroupsGroupidMessagesRoute(router);
registerGetGroupsGroupidMessagesRoute(router);
registerGetWelcomeMessagesRoute(router);
registerPostWelcomeMessagesIdAckRoute(router);
registerPostGroupsGroupidStateRoute(router);
registerGetGroupsGroupidStateRoute(router);

export { router as mlsRouter };
