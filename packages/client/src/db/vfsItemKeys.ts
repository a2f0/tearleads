import { isRecord, toFiniteNumber } from '@tearleads/shared';
import { getDatabaseAdapter, isDatabaseInitialized } from './index';

export interface ItemKeyRecord {
  itemId: string;
  keyEpoch: number;
  sessionKey: Uint8Array;
}

export interface ShareRecord {
  recipientUserId: string;
  keyEpoch: number;
}

export interface ItemKeyStore {
  getItemKey(input: {
    itemId: string;
    keyEpoch?: number;
  }): Promise<ItemKeyRecord | null>;
  setItemKey(record: ItemKeyRecord): Promise<void>;
  getLatestKeyEpoch(itemId: string): Promise<number | null>;
  listItemShares(itemId: string): Promise<ShareRecord[]>;
  addItemShare(input: {
    itemId: string;
    recipientUserId: string;
    keyEpoch: number;
  }): Promise<void>;
  removeItemShare(input: {
    itemId: string;
    recipientUserId: string;
  }): Promise<void>;
}

interface RawItemKeyRow {
  itemId: string;
  keyEpoch: number;
  sessionKeyB64: string;
}

interface RawShareRow {
  recipientUserId: string;
  keyEpoch: number;
}

function normalizeItemKeyRow(value: unknown): RawItemKeyRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const itemId = value['itemId'] ?? value['item_id'];
  const sessionKeyB64 = value['sessionKeyB64'] ?? value['session_key_b64'];
  if (typeof itemId !== 'string' || typeof sessionKeyB64 !== 'string') {
    return null;
  }

  const keyEpoch = toFiniteNumber(value['keyEpoch'] ?? value['key_epoch']);
  if (keyEpoch === null || !Number.isInteger(keyEpoch) || keyEpoch < 1) {
    return null;
  }

  return { itemId, keyEpoch, sessionKeyB64 };
}

function normalizeShareRow(value: unknown): RawShareRow | null {
  if (!isRecord(value)) {
    return null;
  }

  const recipientUserId =
    value['recipientUserId'] ?? value['recipient_user_id'];
  if (typeof recipientUserId !== 'string') {
    return null;
  }

  const keyEpoch = toFiniteNumber(value['keyEpoch'] ?? value['key_epoch']);
  if (keyEpoch === null || !Number.isInteger(keyEpoch) || keyEpoch < 1) {
    return null;
  }

  return { recipientUserId, keyEpoch };
}

function toItemKeyRecord(row: RawItemKeyRow): ItemKeyRecord {
  return {
    itemId: row.itemId,
    keyEpoch: row.keyEpoch,
    sessionKey: base64ToUint8Array(row.sessionKeyB64)
  };
}

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < data.length; index += chunkSize) {
    binary += String.fromCharCode(...data.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export async function getItemKey(input: {
  itemId: string;
  keyEpoch?: number;
}): Promise<ItemKeyRecord | null> {
  if (!isDatabaseInitialized()) {
    return null;
  }

  const adapter = getDatabaseAdapter();

  if (input.keyEpoch !== undefined) {
    const result = await adapter.execute(
      `SELECT
        item_id as itemId,
        key_epoch as keyEpoch,
        session_key_b64 as sessionKeyB64
      FROM vfs_item_keys
      WHERE item_id = ?
        AND key_epoch = ?
      LIMIT 1`,
      [input.itemId, input.keyEpoch]
    );

    const rows = Array.isArray(result.rows) ? result.rows : [];
    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    const normalized = normalizeItemKeyRow(row);
    return normalized === null ? null : toItemKeyRecord(normalized);
  }

  const result = await adapter.execute(
    `SELECT
      item_id as itemId,
      key_epoch as keyEpoch,
      session_key_b64 as sessionKeyB64
    FROM vfs_item_keys
    WHERE item_id = ?
    ORDER BY key_epoch DESC
    LIMIT 1`,
    [input.itemId]
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const row = rows[0];
  if (row === undefined) {
    return null;
  }

  const normalized = normalizeItemKeyRow(row);
  return normalized === null ? null : toItemKeyRecord(normalized);
}

export async function setItemKey(record: ItemKeyRecord): Promise<void> {
  if (!isDatabaseInitialized()) {
    throw new Error('Database not initialized');
  }

  const adapter = getDatabaseAdapter();
  const now = Date.now();
  const sessionKeyB64 = uint8ArrayToBase64(record.sessionKey);

  await adapter.execute(
    `INSERT OR REPLACE INTO vfs_item_keys (
      item_id,
      key_epoch,
      session_key_b64,
      created_at
    ) VALUES (?, ?, ?, ?)`,
    [record.itemId, record.keyEpoch, sessionKeyB64, now]
  );
}

export async function getLatestKeyEpoch(
  itemId: string
): Promise<number | null> {
  if (!isDatabaseInitialized()) {
    return null;
  }

  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT MAX(key_epoch) as maxEpoch
    FROM vfs_item_keys
    WHERE item_id = ?`,
    [itemId]
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  const row = rows[0];
  if (row === undefined || !isRecord(row)) {
    return null;
  }

  const maxEpoch = toFiniteNumber(row['maxEpoch']);
  return maxEpoch !== null && Number.isInteger(maxEpoch) ? maxEpoch : null;
}

export async function listItemShares(itemId: string): Promise<ShareRecord[]> {
  if (!isDatabaseInitialized()) {
    return [];
  }

  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT
      recipient_user_id as recipientUserId,
      key_epoch as keyEpoch
    FROM vfs_item_shares
    WHERE item_id = ?
    ORDER BY key_epoch DESC, recipient_user_id ASC`,
    [itemId]
  );

  const rows = Array.isArray(result.rows) ? result.rows : [];
  return rows
    .map(normalizeShareRow)
    .filter((row): row is RawShareRow => row !== null);
}

export async function addItemShare(input: {
  itemId: string;
  recipientUserId: string;
  keyEpoch: number;
}): Promise<void> {
  if (!isDatabaseInitialized()) {
    throw new Error('Database not initialized');
  }

  const adapter = getDatabaseAdapter();
  const now = Date.now();

  await adapter.execute(
    `INSERT OR REPLACE INTO vfs_item_shares (
      item_id,
      recipient_user_id,
      key_epoch,
      created_at
    ) VALUES (?, ?, ?, ?)`,
    [input.itemId, input.recipientUserId, input.keyEpoch, now]
  );
}

export async function removeItemShare(input: {
  itemId: string;
  recipientUserId: string;
}): Promise<void> {
  if (!isDatabaseInitialized()) {
    throw new Error('Database not initialized');
  }

  const adapter = getDatabaseAdapter();

  await adapter.execute(
    `DELETE FROM vfs_item_shares
    WHERE item_id = ?
      AND recipient_user_id = ?`,
    [input.itemId, input.recipientUserId]
  );
}

export function createItemKeyStore(): ItemKeyStore {
  return {
    getItemKey,
    setItemKey,
    getLatestKeyEpoch,
    listItemShares,
    addItemShare,
    removeItemShare
  };
}
