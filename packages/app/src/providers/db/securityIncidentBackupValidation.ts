import { toFingerprint } from "@tearleads/crypto";
import { requireBackupString } from "./backupTableValidation";
import type { BackupSqlRow } from "./localBackupFormat";
import { readProperty } from "./localBackupPayload";

const identityColumns = [
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
  const parsed: unknown = JSON.parse(evidence);
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
  const identity = JSON.stringify(identityColumns.map((column) => row[column]));
  const id = `incident_v1_${await toFingerprint(new TextEncoder().encode(identity))}`;
  if (readProperty(row, "id") !== id)
    throw new Error("Security incident backup id does not match its evidence");
}

export function retainSecurityIncidentBackupRows(
  rows: readonly BackupSqlRow[],
): BackupSqlRow[] {
  const counts = new Map<string | null, number>();
  return [...rows]
    .sort((left, right) => {
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
          : requireBackupString(row, "trust_domain", "Security incident");
      const count = (counts.get(domain) ?? 0) + 1;
      counts.set(domain, count);
      return count <= 1_000;
    });
}
