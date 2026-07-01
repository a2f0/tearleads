import { keyPackageBackups } from "@tearleads/api-shared/schema";
import type { PutKeyPackageBackupRequest } from "@tearleads/validators/request";
import type { KeyPackageBackupResponse } from "@tearleads/validators/response";
import { and, desc, eq, or } from "drizzle-orm";
import type { ApiServiceRuntime } from "../runtime";

export class KeyPackageBackupError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409,
  ) {
    super(message);
    this.name = "KeyPackageBackupError";
  }
}

type KeyPackageBackupRow = typeof keyPackageBackups.$inferSelect;

function serializeKeyPackageBackupRow(
  row: KeyPackageBackupRow,
): KeyPackageBackupResponse {
  return {
    backupId: row.id,
    userId: row.userId,
    signingKeyFingerprint: row.signingKeyFingerprint,
    credential: row.credential,
    prfSalt: row.prfSalt,
    prfSaltVersion: 1,
    kdfSuite: "webauthn-prf-hkdf-sha256",
    envelope: row.envelope,
    backupVersion: row.backupVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function findBackupConflicts(
  runtime: ApiServiceRuntime,
  input: PutKeyPackageBackupRequest,
): Promise<KeyPackageBackupRow[]> {
  return runtime.db
    .select()
    .from(keyPackageBackups)
    .where(
      or(
        eq(keyPackageBackups.id, input.backupId),
        eq(keyPackageBackups.credentialId, input.credential.id),
      ),
    );
}

function assertUserOwnsConflicts(input: {
  readonly backupId: string;
  readonly conflicts: readonly KeyPackageBackupRow[];
  readonly credentialId: string;
  readonly userId: string;
}): void {
  const foreignConflict = input.conflicts.find(
    (row) => row.userId !== input.userId,
  );
  if (foreignConflict) {
    throw new KeyPackageBackupError("Backup belongs to another user", 403);
  }

  const credentialConflict = input.conflicts.find(
    (row) =>
      row.credentialId === input.credentialId && row.id !== input.backupId,
  );
  if (credentialConflict) {
    throw new KeyPackageBackupError(
      "Credential is already bound to another backup",
      409,
    );
  }
}

export async function putKeyPackageBackup(
  runtime: ApiServiceRuntime,
  userId: string,
  input: PutKeyPackageBackupRequest,
): Promise<KeyPackageBackupResponse> {
  const conflicts = await findBackupConflicts(runtime, input);
  assertUserOwnsConflicts({
    backupId: input.backupId,
    conflicts,
    credentialId: input.credential.id,
    userId,
  });

  const now = new Date();
  const [row] = await runtime.db
    .insert(keyPackageBackups)
    .values({
      id: input.backupId,
      userId,
      signingKeyFingerprint: input.signingKeyFingerprint,
      credentialId: input.credential.id,
      credential: input.credential,
      prfSalt: input.prfSalt,
      prfSaltVersion: input.prfSaltVersion,
      kdfSuite: input.kdfSuite,
      envelope: input.envelope,
      backupVersion: input.backupVersion,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: keyPackageBackups.id,
      set: {
        signingKeyFingerprint: input.signingKeyFingerprint,
        credentialId: input.credential.id,
        credential: input.credential,
        prfSalt: input.prfSalt,
        prfSaltVersion: input.prfSaltVersion,
        kdfSuite: input.kdfSuite,
        envelope: input.envelope,
        backupVersion: input.backupVersion,
        updatedAt: now,
      },
    })
    .returning();

  if (!row) {
    throw new KeyPackageBackupError("Backup was not stored", 409);
  }

  return serializeKeyPackageBackupRow(row);
}

export async function listKeyPackageBackups(
  runtime: ApiServiceRuntime,
  userId: string,
): Promise<KeyPackageBackupResponse[]> {
  const rows = await runtime.db
    .select()
    .from(keyPackageBackups)
    .where(eq(keyPackageBackups.userId, userId))
    .orderBy(desc(keyPackageBackups.updatedAt), desc(keyPackageBackups.id));

  return rows.map(serializeKeyPackageBackupRow);
}

export async function getKeyPackageBackupByCredentialId(
  runtime: ApiServiceRuntime,
  credentialId: string,
): Promise<KeyPackageBackupResponse | null> {
  const [row] = await runtime.db
    .select()
    .from(keyPackageBackups)
    .where(eq(keyPackageBackups.credentialId, credentialId))
    .limit(1);

  return row ? serializeKeyPackageBackupRow(row) : null;
}

export async function deleteKeyPackageBackup(
  runtime: ApiServiceRuntime,
  userId: string,
  backupId: string,
): Promise<void> {
  const [row] = await runtime.db
    .select({
      id: keyPackageBackups.id,
    })
    .from(keyPackageBackups)
    .where(
      and(
        eq(keyPackageBackups.id, backupId),
        eq(keyPackageBackups.userId, userId),
      ),
    )
    .limit(1);

  if (!row) {
    throw new KeyPackageBackupError("Backup not found", 404);
  }

  await runtime.db
    .delete(keyPackageBackups)
    .where(
      and(
        eq(keyPackageBackups.id, backupId),
        eq(keyPackageBackups.userId, userId),
      ),
    );
}
