import { expect, test } from "bun:test";
import { serializeKeyingCanonicalJson, toFingerprint } from "@tearleads/crypto";
import {
  incidentIdentityColumns,
  validateSecurityIncidentBackupIdentity,
} from "./securityIncidentBackupValidation";

async function incidentRow(evidenceHashes: Record<string, string>) {
  const row: Record<string, string | number | null> = {
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
  row.id = `incident_v1_${await toFingerprint(new TextEncoder().encode(identity))}`;
  return row;
}

test("an SDK-written __proto__ evidence key survives backup identity validation", async () => {
  const row = await incidentRow({
    __proto__: "p".repeat(64),
    manifestHash: "m".repeat(64),
  });
  await expect(
    validateSecurityIncidentBackupIdentity(row),
  ).resolves.toBeUndefined();
});

test("evidence text that is not in canonical form is refused", async () => {
  const row = await incidentRow({ b: "1", a: "2" });
  row.evidence_hashes = JSON.stringify({ b: "1", a: "2" });
  await expect(validateSecurityIncidentBackupIdentity(row)).rejects.toThrow(
    "invalid evidence hashes",
  );
});
