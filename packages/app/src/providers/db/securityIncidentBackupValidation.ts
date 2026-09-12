import { toFingerprint } from "@tearleads/crypto";
import { requireBackupString } from "./backupTableValidation";
import type { BackupSqlRow } from "./localBackupFormat";
import { readProperty } from "./localBackupPayload";

export const incidentIdentityColumns = [
  "trust_domain",
  "code",
  "operation",
  "object_kind",
  "object_id",
  "organization_id",
  "evidence_hashes",
];

export async function validateSecurityIncidentBackupIdentity(
  row: BackupSqlRow,
): Promise<void> {
  const evidence = requireBackupString(
    row,
    "evidence_hashes",
    "Security incident",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(evidence);
  } catch {
    throw new Error("Security incident backup has invalid evidence hashes");
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    Object.entries(parsed).some(
      ([key, value]) => key.length === 0 || typeof value !== "string",
    ) ||
    JSON.stringify(parsed) !== evidence
  ) {
    throw new Error("Security incident backup has invalid evidence hashes");
  }
  // incident_v1 hashes the stored JSON text, including its key order. Validate
  // that exact identity instead of imposing this device's locale ordering on
  // a backup created by another runtime.
  const identity = JSON.stringify(
    incidentIdentityColumns.map((column) => row[column]),
  );
  const id = `incident_v1_${await toFingerprint(new TextEncoder().encode(identity))}`;
  if (readProperty(row, "id") !== id)
    throw new Error("Security incident backup id does not match its evidence");
}

export function retainSecurityIncidentBackupRows(
  rows: readonly BackupSqlRow[],
  localIds: ReadonlySet<string>,
): BackupSqlRow[] {
  const counts = new Map<string | null, number>();
  return [...rows]
    .sort((left, right) => {
      const leftLocal = localIds.has(
        requireBackupString(left, "id", "Security incident"),
      );
      const rightLocal = localIds.has(
        requireBackupString(right, "id", "Security incident"),
      );
      if (leftLocal !== rightLocal) return leftLocal ? -1 : 1;
      for (const column of ["last_detected_at", "id"]) {
        const a = requireBackupString(left, column, "Security incident");
        const b = requireBackupString(right, column, "Security incident");
        if (a !== b) return a > b ? -1 : 1;
      }
      return 0;
    })
    .filter((row) => {
      const domain =
        readProperty(row, "trust_domain") === null
          ? null
          : readIncidentText(row, "trust_domain");
      const count = (counts.get(domain) ?? 0) + 1;
      counts.set(domain, count);
      return count <= 1_000;
    });
}

/** Reject a restored clock that could pin future incidents ahead of new evidence. */
export function validateRestoredIncidentTimes(
  rows: readonly BackupSqlRow[],
): void {
  const latestAllowed = Date.now() + 5 * 60 * 1000;
  for (const row of rows) {
    for (const column of ["detected_at", "last_detected_at"]) {
      if (
        Date.parse(requireBackupString(row, column, "Security incident")) >
        latestAllowed
      ) {
        throw new Error(
          "Security incident backup observation is too far in the future",
        );
      }
    }
  }
}

export function readIncidentText(row: BackupSqlRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string")
    throw new Error(`Security incident backup has an invalid ${column} value`);
  return value;
}
