import { expect, test } from "bun:test";
import { makeVerifiedPrincipalPolicy } from "@tearleads/crypto";
import { createNativeTestExecSql } from "@tearleads/test-utils";
import { createPrincipalPolicyBundle } from "../../../../test/helpers/policyCacheFixtures";
import { countingExecSql } from "../../../../test/helpers/statementCounting";
import { PrincipalPolicyBundleRepository } from "./principalPolicyBundleRepository";

const now = () => new Date("2026-01-01T00:00:00.000Z");

async function verifiedEntry(principalId: string) {
  const { bundle } = await createPrincipalPolicyBundle(principalId);
  const state = bundle.currentState;
  return {
    bundle,
    policy: makeVerifiedPrincipalPolicy({
      checkpoint: {
        principalId,
        principalType: state.principalType,
        stateHash: state.stateHash,
        version: state.version,
      },
      history: [
        {
          state,
          projection: bundle.currentProjection,
          grants: bundle.currentGrants,
        },
      ],
      keyEpoch: state.keyEpoch,
      principalId,
      principalType: state.principalType,
      projection: bundle.currentProjection,
      grants: bundle.currentGrants,
      state,
      stateHash: state.stateHash,
      version: state.version,
    }),
  };
}

test("verified policy persistence rechecks the written pins in one set read", async () => {
  const db = createNativeTestExecSql();
  const counted = countingExecSql(db.execSql);
  const entries = await Promise.all([
    verifiedEntry("group-1"),
    verifiedEntry("group-2"),
  ]);
  const persist = () =>
    new PrincipalPolicyBundleRepository(
      counted.execSql,
      now,
    ).persistVerifiedPrincipalPolicyBundlesAtomically({
      entries,
      organizationId: "organization",
    });
  try {
    await persist();
    expect(await counted.count(persist)).toBe(13);
    expect(
      await db.execSql("SELECT * FROM principal_policy_checkpoints"),
    ).toHaveLength(2);
  } finally {
    db.close();
  }
});

test("acknowledged policies set-load validation and set-write their pins", async () => {
  const db = createNativeTestExecSql();
  const counted = countingExecSql(db.execSql);
  const entries = await Promise.all([
    verifiedEntry("group-1"),
    verifiedEntry("group-2"),
  ]);
  const persist = () =>
    new PrincipalPolicyBundleRepository(
      counted.execSql,
      now,
    ).persistLocallyAcknowledgedPrincipalPolicyBundles({
      entries,
      organizationId: "organization",
    });
  try {
    await persist();
    expect(await counted.count(persist)).toBe(10);
    for (const entry of entries) {
      expect(
        await new PrincipalPolicyBundleRepository(
          db.execSql,
        ).loadPrincipalPolicyBundle("group", entry.policy.principalId),
      ).toEqual(entry.bundle);
    }
  } finally {
    db.close();
  }
});

test("acknowledged policy guard keeps input order before a later malformed pin", async () => {
  const db = createNativeTestExecSql();
  const entries = await Promise.all([
    verifiedEntry("first"),
    verifiedEntry("second"),
  ]);
  const persist = (
    selected: ReadonlyArray<(typeof entries)[number]> = entries,
  ) =>
    new PrincipalPolicyBundleRepository(
      db.execSql,
      now,
    ).persistLocallyAcknowledgedPrincipalPolicyBundles({
      entries: selected,
      organizationId: "organization",
    });
  try {
    await persist();
    await db.execSql(
      "UPDATE principal_policy_checkpoints SET version = 2 WHERE principal_id = 'first'",
    );
    await db.execSql(
      "UPDATE principal_policy_checkpoints SET state_hash = NULL WHERE principal_id = 'second'",
    );
    await expect(persist()).rejects.toMatchObject({ code: "rollback" });
    await expect(persist(entries.slice(1))).rejects.toMatchObject({
      code: "invalid_shape",
    });
  } finally {
    db.close();
  }
});

test("policy bundle save reuses the ownership write's returned pin", async () => {
  const db = createNativeTestExecSql();
  const counted = countingExecSql(db.execSql);
  const { bundle } = await createPrincipalPolicyBundle();
  try {
    await new PrincipalPolicyBundleRepository(
      counted.execSql,
      now,
    ).savePrincipalPolicyBundle(bundle, "organization");
    expect(
      await counted.count(() =>
        new PrincipalPolicyBundleRepository(
          counted.execSql,
          now,
        ).savePrincipalPolicyBundle(bundle, "organization"),
      ),
    ).toBe(5);
    expect(
      await new PrincipalPolicyBundleRepository(
        db.execSql,
      ).loadPrincipalPolicyBundle("group", "group-1"),
    ).toEqual(bundle);
  } finally {
    db.close();
  }
});
