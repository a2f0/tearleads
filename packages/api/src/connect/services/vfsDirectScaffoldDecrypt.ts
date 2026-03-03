import { decrypt, importKey } from '@tearleads/shared';
import type { VfsSyncDbRow } from '@tearleads/vfs-sync/vfs';

interface Queryable {
  query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

interface RegistrySessionKeyRow {
  id: string;
  encrypted_session_key: string | null;
}

const SCAFFOLD_UNWRAPPED_PREFIX = 'scaffold-unwrapped:';

function decodeBase64Bytes(value: string): Uint8Array | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const missingPadding = normalized.length % 4;
  const padded =
    missingPadding === 0
      ? normalized
      : `${normalized}${'='.repeat(4 - missingPadding)}`;

  try {
    return Uint8Array.from(Buffer.from(padded, 'base64'));
  } catch {
    return null;
  }
}

async function decryptScaffoldEncryptedName(
  encryptedName: string | null | undefined,
  encryptedSessionKey: string | null | undefined
): Promise<string | null> {
  if (typeof encryptedName !== 'string' || typeof encryptedSessionKey !== 'string') {
    return null;
  }

  if (!encryptedSessionKey.startsWith(SCAFFOLD_UNWRAPPED_PREFIX)) {
    return null;
  }

  const sessionKeyBase64 = encryptedSessionKey
    .slice(SCAFFOLD_UNWRAPPED_PREFIX.length)
    .trim();
  if (sessionKeyBase64.length === 0) {
    return null;
  }

  const sessionKeyBytes = decodeBase64Bytes(sessionKeyBase64);
  const encryptedNameBytes = decodeBase64Bytes(encryptedName);
  if (!sessionKeyBytes || !encryptedNameBytes) {
    return null;
  }

  let decryptedBytes: Uint8Array | null = null;
  try {
    const cryptoKey = await importKey(sessionKeyBytes);
    decryptedBytes = await decrypt(encryptedNameBytes, cryptoKey);
    return new TextDecoder('utf-8', { fatal: true }).decode(decryptedBytes);
  } catch {
    return null;
  } finally {
    sessionKeyBytes.fill(0);
    decryptedBytes?.fill(0);
  }
}

export async function materializeScaffoldEncryptedNames(
  pool: Queryable,
  rows: VfsSyncDbRow[]
): Promise<VfsSyncDbRow[]> {
  const candidateItemIds = Array.from(
    new Set(
      rows
        .filter(
          (row) =>
            typeof row.encrypted_name === 'string' &&
            row.encrypted_name.trim().length > 0
        )
        .map((row) => row.item_id)
    )
  );

  if (candidateItemIds.length === 0) {
    return rows;
  }

  const keyRows = await pool.query<RegistrySessionKeyRow>(
    `SELECT id, encrypted_session_key
       FROM vfs_registry
      WHERE id = ANY($1::text[])`,
    [candidateItemIds]
  );
  const keyByItemId = new Map(
    keyRows.rows.map((row) => [row.id, row.encrypted_session_key])
  );

  const normalizedRows: VfsSyncDbRow[] = [];
  for (const row of rows) {
    const decryptedName = await decryptScaffoldEncryptedName(
      row.encrypted_name,
      keyByItemId.get(row.item_id)
    );

    if (decryptedName === null) {
      normalizedRows.push(row);
      continue;
    }

    normalizedRows.push({
      ...row,
      encrypted_name: decryptedName
    });
  }

  return normalizedRows;
}
