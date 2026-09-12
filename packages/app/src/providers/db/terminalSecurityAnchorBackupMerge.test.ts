import { expect, test } from "bun:test";
import { toFingerprint } from "@tearleads/crypto";
import type { BackupSqlRow, BackupTable } from "./localBackupFormat";
import { readProperty } from "./localBackupPayload";
import { mergeSecurityIncidentBackupTables } from "./terminalSecurityAnchorBackupMerge";

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

test("restore keeps only the newest thousand incidents in each trust domain", async () => {
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
    expect(readProperty(kept[0] ?? {}, "object_id")).toBe("document-1004");
    expect(readProperty(kept.at(-1) ?? {}, "object_id")).toBe("document-5");
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
  ).rejects.toThrow("columns are invalid");
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
