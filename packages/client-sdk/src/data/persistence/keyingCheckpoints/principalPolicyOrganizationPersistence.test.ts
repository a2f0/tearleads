import { expect, test } from "bun:test";
import { createTestExecSql } from "@tearleads/test-utils";
import { createPrincipalPolicyBundle } from "../../../../test/helpers/policyCacheFixtures";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import {
  principalPolicies,
  principalPolicyBundleHistory,
  principalPolicyCheckpoints,
  principalPolicyTables,
} from "../../sqlite/schema";
import { getClientSQLitePersistenceRuntime } from "../../sqlite/sqlitePersistenceRuntime";
import { ensureSqlTables } from "../../sqlite/sqlTableSchema";
import {
  retainPrincipalPolicyBundleInTransaction,
  savePrincipalPolicyBundle,
} from "../principalPolicy/principalPolicyPersistence";
import {
  loadStoredPrincipalPolicyCheckpoint,
  upsertPrincipalPolicyCheckpointInTransaction,
  upsertPrincipalPolicyCheckpointsInTransaction,
} from "./keyingCheckpointPersistence";
import { recordPrincipalPolicyOrganizationInTransaction } from "./principalPolicyOrganizationPersistence";

test.each([undefined, ""])(
  "group policy writes refuse missing ownership atomically (%s)",
  async (organizationId) => {
    const { close, execSql } = await createTestExecSql("policy-owner-required");
    try {
      const { bundle } = await createPrincipalPolicyBundle();
      const updatedAt = "2026-09-04T00:00:00.000Z";
      await expect(
        Reflect.apply(savePrincipalPolicyBundle, undefined, [
          execSql,
          bundle,
          updatedAt,
          organizationId,
        ]),
      ).rejects.toThrow("require an organization ID");
      const runtime = getClientSQLitePersistenceRuntime(execSql);
      await expect(
        runtime.transaction((tx) =>
          retainPrincipalPolicyBundleInTransaction(
            tx,
            bundle,
            updatedAt,
            organizationId,
          ),
        ),
      ).rejects.toThrow("require an organization ID");
      await expect(
        runtime.transaction((tx) =>
          upsertPrincipalPolicyCheckpointInTransaction(
            tx,
            {
              principalId: bundle.currentState.principalId,
              principalType: "group",
              stateHash: bundle.currentState.stateHash,
              version: bundle.currentState.version,
            },
            updatedAt,
            organizationId,
          ),
        ),
      ).rejects.toThrow("require an organization ID");
      expect(await runtime.db.select().from(principalPolicies)).toEqual([]);
      expect(
        await runtime.db.select().from(principalPolicyBundleHistory),
      ).toEqual([]);
      expect(
        await runtime.db.select().from(principalPolicyCheckpoints),
      ).toEqual([]);
    } finally {
      close();
    }
  },
);

test("policy cache writes pin organization ownership and reject rebinding", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-organization-ownership",
  );
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-08-29T00:00:00.000Z",
      "org-one",
    );
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    // Owned, not pinned: the pin readers see no checkpoint.
    expect(await runtime.db.select().from(principalPolicyCheckpoints)).toEqual([
      {
        organizationId: "org-one",
        principalId: bundle.currentState.principalId,
        principalType: "group",
        version: null,
        stateHash: null,
        updatedAt: null,
      },
    ]);
    expect(
      await loadStoredPrincipalPolicyCheckpoint(runtime.db, {
        principalId: bundle.currentState.principalId,
        principalType: "group",
      }),
    ).toBeNull();

    await expect(
      savePrincipalPolicyBundle(
        execSql,
        bundle,
        "2026-08-29T00:01:00.000Z",
        "org-two",
      ),
    ).rejects.toMatchObject({ code: "object_mismatch" });
  } finally {
    close();
  }
});

test("one row carries the owner and the pin, and ownership never clears a pin", async () => {
  const { close, execSql } = await createTestExecSql("policy-owner-and-pin");
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    const principal = {
      principalId: bundle.currentState.principalId,
      principalType: "group" as const,
    };
    const checkpoint = {
      ...principal,
      stateHash: bundle.currentState.stateHash,
      version: bundle.currentState.version,
    };
    const updatedAt = "2026-09-04T00:00:00.000Z";
    await savePrincipalPolicyBundle(execSql, bundle, updatedAt, "org-one");
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    await runtime.transaction((tx) =>
      upsertPrincipalPolicyCheckpointInTransaction(
        tx,
        checkpoint,
        updatedAt,
        "org-one",
      ),
    );
    // Caching again records ownership and keeps the pin.
    await savePrincipalPolicyBundle(execSql, bundle, updatedAt, "org-one");
    const pinned = {
      ...principal,
      organizationId: "org-one",
      version: checkpoint.version,
      stateHash: checkpoint.stateHash,
      updatedAt,
    };
    expect(await runtime.db.select().from(principalPolicyCheckpoints)).toEqual([
      pinned,
    ]);
    expect(
      await loadStoredPrincipalPolicyCheckpoint(runtime.db, principal),
    ).toEqual(checkpoint);
    // Another organization can neither pin nor claim the principal.
    await expect(
      runtime.transaction((tx) =>
        upsertPrincipalPolicyCheckpointInTransaction(
          tx,
          { ...checkpoint, version: checkpoint.version + 1 },
          "2026-09-05T00:00:00.000Z",
          "org-two",
        ),
      ),
    ).rejects.toMatchObject({ code: "object_mismatch" });
    expect(await runtime.db.select().from(principalPolicyCheckpoints)).toEqual([
      pinned,
    ]);
  } finally {
    close();
  }
});

test("a half-written pin is refused rather than read as no checkpoint", async () => {
  const { close, execSql } = await createTestExecSql("policy-half-pin");
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-09-04T00:00:00.000Z",
      "org-one",
    );
    const runtime = getClientSQLitePersistenceRuntime(execSql);
    await runtime.db
      .update(principalPolicyCheckpoints)
      .set({ version: 3 })
      .run();
    await expect(
      loadStoredPrincipalPolicyCheckpoint(runtime.db, {
        principalId: bundle.currentState.principalId,
        principalType: "group",
      }),
    ).rejects.toMatchObject({ code: "invalid_shape" });
  } finally {
    close();
  }
});

test("recording ownership or a pin takes one statement per batch", async () => {
  const sqlite = await createTestExecSql("policy-owner-statements");
  try {
    await ensureSqlTables(sqlite.execSql, principalPolicyTables);
    const counted = countingExecSql(sqlite.execSql);
    const runtime = getClientSQLitePersistenceRuntime(counted.execSql);
    const inTransaction = (work: Parameters<typeof runtime.transaction>[0]) =>
      counted.count(() => runtime.transaction(work));
    const group = (index: number) => ({
      principalId: `group-${index}`,
      principalType: "group" as const,
    });
    const checkpoint = (index: number) => ({
      ...group(index),
      stateHash: "a".repeat(64),
      version: 2,
    });
    const updatedAt = "2026-09-04T00:00:00.000Z";
    // BEGIN, the owner upsert, COMMIT (was 4: an owner read and insert).
    expect(
      await inTransaction((tx) =>
        recordPrincipalPolicyOrganizationInTransaction(tx, {
          ...group(0),
          organizationId: "org-one",
        }),
      ),
    ).toBe(3);
    // BEGIN, the owner-and-pin upsert, COMMIT (was 5: an owner read, an
    // owner insert and the checkpoint upsert).
    expect(
      await inTransaction((tx) =>
        upsertPrincipalPolicyCheckpointInTransaction(
          tx,
          checkpoint(0),
          updatedAt,
          "org-one",
        ),
      ),
    ).toBe(3);
    // Sixteen pins write in one statement too (was 5, as for one pin).
    expect(
      await inTransaction((tx) =>
        upsertPrincipalPolicyCheckpointsInTransaction(
          tx,
          Array.from({ length: 16 }, (_, index) => checkpoint(index)),
          updatedAt,
          "org-one",
        ),
      ),
    ).toBe(3);
    expect(
      await runtime.db.select().from(principalPolicyCheckpoints),
    ).toHaveLength(16);
  } finally {
    sqlite.close();
  }
});
