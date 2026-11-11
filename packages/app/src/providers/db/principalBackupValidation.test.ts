import { expect, test } from "bun:test";
import {
  backupCurrent,
  backupEntry,
  backupHead,
  backupPolicyRequest,
  backupProjection,
  identityBackupTable,
} from "../../../test/helpers/principalBackupFixture";
import { validateBackupSchema } from "./backupSchemaValidation";

test.each([undefined, "A".repeat(64), "a".repeat(63)])(
  "backup current projections reject obsolete identity commitment %s",
  async (fingerprint) => {
    const projection = backupProjection.map((member) => ({
      ...member,
      identityBundleFingerprint: fingerprint,
    }));
    const table = await identityBackupTable("principalPolicyBundles", {
      current_projection_json: JSON.stringify(projection),
    });
    expect(() =>
      validateBackupSchema({ tables: [table], indexes: [] }),
    ).toThrow("obsolete principal identity format");
  },
);

const legacyProjection = [
  { userId: backupProjection[0]?.userId, role: "admin" },
];
const legacyEntry = { ...backupEntry, projection: legacyProjection };
const legacyCurrent = { ...backupCurrent, currentProjection: legacyProjection };
const legacyRequest = { ...backupPolicyRequest, projection: legacyProjection };

test.each([
  ["principalPolicyBundles", "previous_states_json", [legacyEntry]],
  ["principalHistoryPrefixes", "current_json", legacyCurrent],
  [
    "principalHistoryPrefixes",
    "head_json",
    { ...backupHead, currentProjection: legacyProjection },
  ],
  ["principalHistoryStages", "current_json", legacyCurrent],
  ["principalHistoryEntries", "entry_json", legacyEntry],
  [
    "principalMutationJournal",
    "serialized_request",
    { kind: "organization", groupId: null, request: legacyRequest },
  ],
  [
    "organizationProvisioningAttempts",
    "serialized_artifacts",
    {
      initialAdminGroup: {
        groupId: backupHead.principalId,
        initialGroupPolicy: legacyRequest,
      },
      initialMemberGroup: {
        groupId: backupHead.principalId,
        initialGroupPolicy: backupPolicyRequest,
      },
      initialOrganizationPolicy: backupPolicyRequest,
    },
  ],
] as const)(
  "rejects embedded obsolete projections in %s.%s",
  async (name, column, value) => {
    const table = await identityBackupTable(name, {
      [column]: JSON.stringify(value),
    });
    expect(() =>
      validateBackupSchema({ tables: [table], indexes: [] }),
    ).toThrow("obsolete principal identity format");
  },
);

for (const name of [
  "principalHistoryPrefixes",
  "principalHistoryStages",
] as const) {
  test.each([null, backupHead, backupCurrent])(
    `${name} preserves public null/reference and private current shapes: %j`,
    async (current) => {
      const table = await identityBackupTable(name, {
        current_json: JSON.stringify(current),
      });
      expect(() =>
        validateBackupSchema({ tables: [table], indexes: [] }),
      ).not.toThrow();
    },
  );
  test(`${name} refuses private projections hidden in public references`, async () => {
    const table = await identityBackupTable(name, {
      current_json: JSON.stringify({
        ...backupHead,
        currentProjection: legacyProjection,
      }),
    });
    expect(() =>
      validateBackupSchema({ tables: [table], indexes: [] }),
    ).toThrow("obsolete principal identity format");
  });
}

test("backup rejects duplicate case-folded SQL declarations before restore", async () => {
  const table = await identityBackupTable("principalPolicyBundles");
  expect(() =>
    validateBackupSchema({
      tables: [
        {
          ...table,
          sql: table.sql.replace(
            '"current_projection_json" TEXT NOT NULL,',
            '"CURRENT_PROJECTION_JSON" TEXT, "current_projection_json" TEXT NOT NULL,',
          ),
        },
      ],
      indexes: [],
    }),
  ).toThrow("obsolete principal identity format");
});

test.each([
  "principalPolicyBundles",
  "principalHistoryPrefixes",
  "principalHistoryStages",
  "principalHistoryEntries",
  "principalMutationJournal",
  "organizationProvisioningAttempts",
] as const)("current-format %s is accepted", async (name) => {
  const table = await identityBackupTable(name);
  expect(() =>
    validateBackupSchema({ tables: [table], indexes: [] }),
  ).not.toThrow();
});
