import { getDatabaseAdapter } from '@/db';

function chunkArray<T>(values: readonly T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function tableExists(tableName: string): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const result = await adapter.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    [tableName]
  );
  return result.rows.length > 0;
}

function getNullableString(
  row: Record<string, unknown>,
  key: string
): string | null {
  const value = row[key];
  return typeof value === 'string' ? value : null;
}

function getNullableNumber(
  row: Record<string, unknown>,
  key: string
): number | null {
  const value = row[key];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

async function resolveExistingUserIds(
  candidateIds: readonly string[],
  batchSize: number
): Promise<Set<string>> {
  const adapter = getDatabaseAdapter();
  const existing = new Set<string>();
  for (const chunk of chunkArray(candidateIds, batchSize)) {
    if (chunk.length === 0) {
      continue;
    }
    const placeholders = chunk.map(() => '?').join(', ');
    const result = await adapter.execute(
      `SELECT id FROM users WHERE id IN (${placeholders})`,
      [...chunk]
    );
    for (const row of result.rows) {
      const id = getNullableString(row, 'id');
      if (id) {
        existing.add(id);
      }
    }
  }
  return existing;
}

async function usersRequirePersonalOrganizationId(): Promise<boolean> {
  const adapter = getDatabaseAdapter();
  const tableInfoResult = await adapter.execute(
    `PRAGMA table_info("users")`,
    []
  );
  for (const row of tableInfoResult.rows) {
    const columnName = getNullableString(row, 'name');
    if (columnName !== 'personal_organization_id') {
      continue;
    }
    const notNull = getNullableNumber(row, 'notnull');
    return notNull === 1;
  }
  return false;
}

function buildPlaceholderEmail(userId: string): string {
  return `vfs-bootstrap+${userId}@tearleads.local`;
}

function buildPersonalOrganizationId(userId: string): string {
  return `personal:${userId}`;
}

export async function ensureGrantorUsersExist(
  grantorIds: readonly string[],
  batchSize: number
): Promise<void> {
  const uniqueGrantorIds = Array.from(new Set(grantorIds));
  if (uniqueGrantorIds.length === 0) {
    return;
  }
  if (!(await tableExists('users'))) {
    return;
  }

  const existingUserIds = await resolveExistingUserIds(
    uniqueGrantorIds,
    batchSize
  );
  const missingUserIds = uniqueGrantorIds.filter(
    (userId) => !existingUserIds.has(userId)
  );
  if (missingUserIds.length === 0) {
    return;
  }

  const adapter = getDatabaseAdapter();
  const requirePersonalOrg = await usersRequirePersonalOrganizationId();
  const nowMs = Date.now();

  if (requirePersonalOrg && (await tableExists('organizations'))) {
    for (const userId of missingUserIds) {
      const personalOrganizationId = buildPersonalOrganizationId(userId);
      await adapter.execute(
        `INSERT INTO organizations (id, name, is_personal, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [personalOrganizationId, `Bootstrap User ${userId}`, 1, nowMs, nowMs]
      );
    }

    for (const userId of missingUserIds) {
      await adapter.execute(
        `INSERT INTO users (id, email, email_confirmed, personal_organization_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        [
          userId,
          buildPlaceholderEmail(userId),
          0,
          buildPersonalOrganizationId(userId),
          nowMs,
          nowMs
        ]
      );
    }
    return;
  }

  for (const userId of missingUserIds) {
    await adapter.execute(
      `INSERT INTO users (id, email, email_confirmed)
       VALUES (?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
      [userId, buildPlaceholderEmail(userId), 0]
    );
  }
}
