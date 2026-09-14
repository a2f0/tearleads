import { expect, test } from "bun:test";
import { serializeKeyingCanonicalJson, toFingerprint } from "@tearleads/crypto";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";
import { readProperty } from "./localBackupPayload";
import {
  DocumentPurgeCheckpointConflictError,
  mergeDocumentPurgeCheckpointBackupTables,
  mergeSecurityIncidentBackupTables,
} from "./terminalSecurityAnchorBackupMerge";

async function incident(
  index = 0,
  trustDomain: string | null = null,
): Promise<BackupSqlRow> {
  const identity = [
    trustDomain,
    "equivocation",
    "sync",
    "document",
    `document-${index}`,
    "organization",
    "{}",
  ];
  return {
    id: `incident_v1_${await toFingerprint(new TextEncoder().encode(JSON.stringify(identity)))}`,
    trust_domain: trustDomain,
    code: "equivocation",
    operation: "sync",
    object_kind: "document",
    object_id: `document-${index}`,
    organization_id: "organization",
    evidence_hashes: "{}",
    detected_at: new Date(index * 1000).toISOString(),
    last_detected_at: new Date(index * 1000).toISOString(),
    occurrence_count: 1,
  };
}

function table(rows: BackupSqlRow[]): BackupTable {
  return {
    name: "security_incidents",
    sql: "unused in pure merge",
    columns: Object.keys(rows[0] ?? {}),
    rows,
  };
}

test("a backup cannot preseed another incident id with forged evidence", async () => {
  const row = await incident();
  const forged = table([
    { ...row, code: "unauthorized", object_id: "innocuous" },
  ]);
  await expect(
    mergeSecurityIncidentBackupTables({ current: null, restored: forged }),
  ).rejects.toThrow("id does not match its evidence");
});

test("restore preserves local incidents and fills each domain with the newest imports", async () => {
  const rows = await Promise.all(
    [null, "realm"].flatMap((domain) =>
      Array.from({ length: 1005 }, (_, index) => incident(index, domain)),
    ),
  );
  const current = table(
    rows.filter(
      (row) => Number(String(readProperty(row, "object_id")).slice(9)) < 700,
    ),
  );
  const restored = table(
    rows.filter(
      (row) => Number(String(readProperty(row, "object_id")).slice(9)) >= 500,
    ),
  );
  const merged = await mergeSecurityIncidentBackupTables({ current, restored });
  expect(merged?.rows).toHaveLength(2000);
  for (const domain of [null, "realm"]) {
    const kept =
      merged?.rows.filter(
        (row) => readProperty(row, "trust_domain") === domain,
      ) ?? [];
    expect(kept).toHaveLength(1000);
    const ids = new Set(kept.map((row) => readProperty(row, "object_id")));
    expect(ids.has("document-0")).toBe(true);
    expect(ids.has("document-699")).toBe(true);
    expect(ids.has("document-1004")).toBe(true);
    expect(ids.has("document-700")).toBe(false);
  }
});

test("equal-time retention breaks ties by descending incident id", async () => {
  const rows = await Promise.all(
    Array.from({ length: 1001 }, (_, index) => incident(index)),
  );
  const normalized = rows.map((row) => ({
    ...row,
    detected_at: new Date(0).toISOString(),
    last_detected_at: new Date(0).toISOString(),
  }));
  const merged = await mergeSecurityIncidentBackupTables({
    current: null,
    restored: table(normalized),
  });
  const orderedIds = rows
    .map((row) => readProperty(row, "id"))
    .sort()
    .reverse();
  expect(merged?.rows.map((row) => readProperty(row, "id"))).toEqual(
    orderedIds.slice(0, 1000),
  );
});

for (const [label, change] of [
  ["non-canonical time", { detected_at: "1970-01-01T00:00:00Z" }],
  ["invalid time", { detected_at: "not-a-time" }],
  ["reversed time", { detected_at: "2000-01-01T00:00:00.000Z" }],
  ["zero count", { occurrence_count: 0 }],
  ["invalid trust domain", { trust_domain: 123 }],
  ["invalid object id", { object_id: 123 }],
  ["invalid evidence", { evidence_hashes: "[]" }],
  ["malformed evidence", { evidence_hashes: "{" }],
  [
    "non-canonical evidence key order",
    { evidence_hashes: '{"9":"y","10":"x"}' },
  ],
  ["locale-ordered evidence keys", { evidence_hashes: '{"b":"1","B":"2"}' }],
] as const) {
  test(`restore rejects an incident with ${label}`, async () => {
    const restored = table([{ ...(await incident()), ...change }]);
    await expect(
      mergeSecurityIncidentBackupTables({ current: null, restored }),
    ).rejects.toThrow();
  });
}

test("restore rejects duplicate incident identities and invalid column sets", async () => {
  const row = await incident();
  await expect(
    mergeSecurityIncidentBackupTables({
      current: null,
      restored: table([row, row]),
    }),
  ).rejects.toThrow("duplicate scope");
  const restored = { ...table([row]), columns: ["id"] };
  await expect(
    mergeSecurityIncidentBackupTables({ current: null, restored }),
  ).rejects.toThrow("is missing the trust_domain column");
  const duplicated = {
    ...table([row]),
    columns: [...table([row]).columns, "id"],
  };
  await expect(
    mergeSecurityIncidentBackupTables({ current: null, restored: duplicated }),
  ).rejects.toThrow("columns are invalid");
});

test("incident columns added on one side pass through only when the surviving schema has them", async () => {
  const row = await incident();
  const current = table([{ ...row, note: "live" }]);
  const restored = table([
    { ...row, occurrence_count: 4 },
    { ...(await incident(1)), other: "backup-only" },
  ]);
  const merged = await mergeSecurityIncidentBackupTables({ current, restored });
  expect(merged?.columns).toEqual(current.columns);
  expect(merged?.rows).toEqual([
    { ...row, note: "live", occurrence_count: 4 },
    await incident(1),
  ]);
});

function purgeCheckpoint(overrides: Partial<BackupSqlRow> = {}): BackupSqlRow {
  return {
    document_id: "document-1",
    organization_id: "organization-1",
    document_manifest_hash: "a".repeat(64),
    purge_event_hash: "b".repeat(64),
    updated_at: "2026-09-12T12:00:00.000Z",
    ...overrides,
  };
}

test("a differing purge pin for a pinned document is a typed object mismatch", () => {
  const current = purgeCheckpoint();
  const restored = purgeCheckpoint({ purge_event_hash: "c".repeat(64) });
  const purgeTable = (rows: BackupSqlRow[]): BackupTable => ({
    name: "document_purge_checkpoints",
    sql: "unused in pure merge",
    columns: Object.keys(rows[0] ?? {}),
    rows,
  });
  let thrown: unknown;
  try {
    mergeDocumentPurgeCheckpointBackupTables({
      current: purgeTable([current]),
      restored: purgeTable([restored]),
    });
  } catch (error) {
    thrown = error;
  }
  if (!(thrown instanceof DocumentPurgeCheckpointConflictError)) {
    throw new Error("Expected a typed purge checkpoint conflict");
  }
  expect(thrown.code).toBe("object_mismatch");
  expect(thrown.message).toBe(
    "Backup disagrees with the local document purge checkpoint",
  );
  expect(thrown.documentId).toBe("document-1");
  expect(thrown.incident).toEqual({
    evidenceHashes: {
      current_document_manifest_hash: "a".repeat(64),
      current_purge_event_hash: "b".repeat(64),
      restored_document_manifest_hash: "a".repeat(64),
      restored_purge_event_hash: "c".repeat(64),
    },
    objectId: "document-1",
    objectKind: "document",
    operation: "backup.restore",
    organizationId: "organization-1",
  });
});

test("either side alone retains validated incident evidence", async () => {
  const value = table([await incident()]);
  expect(
    await mergeSecurityIncidentBackupTables({ current: value, restored: null }),
  ).toEqual(value);
  expect(
    await mergeSecurityIncidentBackupTables({ current: null, restored: value }),
  ).toEqual(value);
});

test("a future-dated backup flood cannot evict current or subsequent evidence", async () => {
  const current = table([await incident()]);
  const future = new Date(Date.now() + 86400000).toISOString();
  const rows = await Promise.all(
    Array.from({ length: 1000 }, (_, index) => incident(index + 1)),
  );
  const restored = table(
    rows.map((row) => ({
      ...row,
      detected_at: future,
      last_detected_at: future,
    })),
  );
  await expect(
    mergeSecurityIncidentBackupTables({ current, restored }),
  ).rejects.toThrow("too far in the future");
  await expect(
    mergeSecurityIncidentBackupTables({ current: null, restored }),
  ).rejects.toThrow("too far in the future");
});

test("near-present imported rows cannot evict the local incident ledger", async () => {
  const local = await Promise.all(
    Array.from({ length: 1000 }, (_, index) => incident(index)),
  );
  const nearFuture = new Date(Date.now() + 4 * 60000).toISOString();
  const imported = await Promise.all(
    Array.from({ length: 1000 }, (_, index) => incident(index + 1000)),
  );
  const merged = await mergeSecurityIncidentBackupTables({
    current: table(local),
    restored: table(
      imported.map((row) => ({
        ...row,
        detected_at: nearFuture,
        last_detected_at: nearFuture,
      })),
    ),
  });
  expect(new Set(merged?.rows.map((row) => readProperty(row, "id")))).toEqual(
    new Set(local.map((row) => readProperty(row, "id"))),
  );
});

test("incident text accepts the empty values permitted by the writer", async () => {
  // Code-unit key order, as the SDK writer serializes it: "10" < "9" < "manifest".
  const evidence = serializeKeyingCanonicalJson({
    "9": "nine",
    "10": "ten",
    manifest: "hash",
  });
  expect(evidence).toBe('{"10":"ten","9":"nine","manifest":"hash"}');
  const identity = ["", "equivocation", " ", "document", "", "", evidence];
  const row = {
    ...(await incident()),
    trust_domain: "",
    operation: " ",
    object_id: "",
    organization_id: "",
    evidence_hashes: evidence,
    id: `incident_v1_${await toFingerprint(new TextEncoder().encode(JSON.stringify(identity)))}`,
  };
  const value = table([row]);
  expect(
    await mergeSecurityIncidentBackupTables({ current: value, restored: null }),
  ).toEqual(value);
  expect(
    await mergeSecurityIncidentBackupTables({ current: null, restored: value }),
  ).toEqual(value);
});
