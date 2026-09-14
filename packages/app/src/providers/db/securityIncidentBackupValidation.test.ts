import { expect, test } from "bun:test";
import { serializeKeyingCanonicalJson, toFingerprint } from "@tearleads/crypto";
import {
  incidentIdentityColumns,
  validateSecurityIncidentBackupIdentity,
} from "./securityIncidentBackupValidation";

type IncidentRow = Record<string, string | number | null>;

async function incidentRow(
  evidenceHashes: Record<string, string>,
): Promise<IncidentRow> {
  const row: IncidentRow = {
    code: "rollback",
    evidence_hashes: serializeKeyingCanonicalJson(evidenceHashes),
    object_id: "object",
    object_kind: "document",
    operation: "document.sync",
    organization_id: "org",
    trust_domain: "trust",
  };
  const identity = JSON.stringify(
    incidentIdentityColumns.map((column) => row[column]),
  );
  return {
    ...row,
    id: `incident_v1_${await toFingerprint(new TextEncoder().encode(identity))}`,
  };
}

test("an SDK-written __proto__ evidence key survives backup identity validation", async () => {
  // A computed key: the literal `__proto__:` in an object literal sets the
  // prototype instead of creating an own property.
  const evidenceHashes = Object.fromEntries([
    ["__proto__", "p".repeat(64)],
    ["manifestHash", "m".repeat(64)],
  ]) as Record<string, string>;
  expect(Object.hasOwn(evidenceHashes, "__proto__")).toBe(true);
  const row = await incidentRow(evidenceHashes);
  const { evidence_hashes: evidenceText } = row;
  expect(evidenceText).toContain('"__proto__"');
  await expect(
    validateSecurityIncidentBackupIdentity(row),
  ).resolves.toBeUndefined();
});

test("evidence text that is not in canonical form is refused", async () => {
  const row = await incidentRow({ b: "1", a: "2" });
  await expect(
    validateSecurityIncidentBackupIdentity({
      ...row,
      evidence_hashes: JSON.stringify({ b: "1", a: "2" }),
    }),
  ).rejects.toThrow("invalid evidence hashes");
});
