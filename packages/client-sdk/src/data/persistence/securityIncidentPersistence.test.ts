import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import { appendSecurityIncident } from "./securityIncidentPersistence";

const incident = {
  code: "hash_mismatch",
  detectedAt: "2026-09-12T00:00:00.000Z",
  lastDetectedAt: "2026-09-12T00:00:00.000Z",
  objectId: "document-1",
  objectKind: "document",
  occurrenceCount: 1,
  operation: "document.verify",
  trustDomain: "https://api.example.test",
} as const;

// Code-unit order: "1" (0x31) < "9" (0x39) < "B" (0x42) < "b" (0x62). Every
// locale collation puts the lowercase letter first and most sort "9" before
// "10", so this text differs from any localeCompare serialization.
const canonicalEvidence = '{"10":"x","9":"y","B":"2","b":"1"}';

test("evidence hashes serialize in code-unit key order so incident ids agree across runtimes", async () => {
  const { close, execSql } = await createTestExecSql(
    "security-incident-evidence-order",
  );
  try {
    const stored = await appendSecurityIncident(execSql, {
      ...incident,
      evidenceHashes: { b: "1", B: "2", "10": "x", "9": "y" },
    });
    if (!stored) {
      throw new Error("Expected the incident to be stored");
    }
    expect(
      await execSql('SELECT "id", "evidence_hashes" FROM "security_incidents"'),
    ).toEqual([{ id: stored.id, evidence_hashes: canonicalEvidence }]);
    const identity = JSON.stringify([
      incident.trustDomain,
      incident.code,
      incident.operation,
      incident.objectKind,
      incident.objectId,
      null,
      canonicalEvidence,
    ]);
    expect(stored.id).toBe(
      `incident_v1_${await toFingerprint(new TextEncoder().encode(identity))}`,
    );

    const again = await appendSecurityIncident(execSql, {
      ...incident,
      evidenceHashes: { "9": "y", b: "1", "10": "x", B: "2" },
    });
    expect(again?.id).toBe(stored.id);
    expect(again?.occurrenceCount).toBe(2);
    expect(again?.evidenceHashes).toEqual({
      "10": "x",
      "9": "y",
      B: "2",
      b: "1",
    });
  } finally {
    await close();
  }
});
