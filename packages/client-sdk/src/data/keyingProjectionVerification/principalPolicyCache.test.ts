import { expect, test } from "bun:test";
import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import {
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
  referencedPrincipalStateFromPolicyState,
} from "../../../test/helpers/policyCacheFixtures";
import { loadPrincipalPolicyCheckpoint } from "../persistence/keyingCheckpointPersistence";
import {
  ensurePrincipalPolicyTables,
  savePrincipalPolicyBundle,
} from "../persistence/principalPolicyPersistence";
import {
  filterUncachedPrincipalPolicyReferences,
  principalPolicyBundleContainsReference,
  referencedPrincipalPolicyKey,
} from "./principalPolicyCache";

const EMPTY_CACHE: ReadonlyMap<string, VerifiedPrincipalPolicy> = new Map();

test("filterUncachedPrincipalPolicyReferences treats a reference with no stored bundle as uncached", async () => {
  const { close, execSql } = await createTestExecSql("principal-policy-cache");
  try {
    await ensurePrincipalPolicyTables(execSql);
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      principalPolicyCache: EMPTY_CACHE,
      references: [reference],
    });

    expect(uncached).toEqual([reference]);
  } finally {
    close();
  }
});

test("filterUncachedPrincipalPolicyReferences treats an exact currentState match as cached", async () => {
  const { close, execSql } = await createTestExecSql("principal-policy-cache");
  try {
    const { bundle } = await createPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-04-08T00:00:00.000Z",
    );

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      principalPolicyCache: EMPTY_CACHE,
      references: [referencedPrincipalStateFromBundle(bundle)],
    });

    expect(uncached).toEqual([]);
  } finally {
    close();
  }
});

test("filterUncachedPrincipalPolicyReferences treats an exact previousStates match as cached", async () => {
  const { close, execSql } = await createTestExecSql("principal-policy-cache");
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected successor bundle to include a previous state");
    }
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      bundle,
      "2026-04-08T00:00:00.000Z",
    );

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      principalPolicyCache: EMPTY_CACHE,
      references: [referencedPrincipalStateFromPolicyState(previousState)],
    });

    expect(uncached).toEqual([]);
  } finally {
    close();
  }
});

test("filterUncachedPrincipalPolicyReferences re-warms when the stored bundle lacks the exact referenced state", async () => {
  const { close, execSql } = await createTestExecSql("principal-policy-cache");
  try {
    // Store the older bundle, then reference the newer (successor) state. The
    // stored bundle's chain does not contain the successor head, so the
    // tightened exact-state match must re-warm rather than treat it as cached.
    const { bundle: olderBundle } = await createPrincipalPolicyBundle();
    const { bundle: newerBundle } =
      await createSuccessorPrincipalPolicyBundle();
    await ensurePrincipalPolicyTables(execSql);
    await savePrincipalPolicyBundle(
      execSql,
      olderBundle,
      "2026-04-08T00:00:00.000Z",
    );
    const reference = referencedPrincipalStateFromBundle(newerBundle);

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      principalPolicyCache: EMPTY_CACHE,
      references: [reference],
    });

    expect(uncached).toEqual([reference]);
  } finally {
    close();
  }
});

test("filterUncachedPrincipalPolicyReferences treats an in-memory cache hit as cached without touching storage", async () => {
  const { close, execSql } = await createTestExecSql("principal-policy-cache");
  try {
    await ensurePrincipalPolicyTables(execSql);
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    // Nothing is persisted; only the in-memory cache holds the key. A hit there
    // must short-circuit the storage lookup.
    const cache = new Map<string, VerifiedPrincipalPolicy>([
      [referencedPrincipalPolicyKey(reference), {} as VerifiedPrincipalPolicy],
    ]);

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      principalPolicyCache: cache,
      references: [reference],
    });

    expect(uncached).toEqual([]);
  } finally {
    close();
  }
});

test("filterUncachedPrincipalPolicyReferences re-warms a cache behind the durable pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-cache-behind-pin",
  );
  try {
    const { bundle: olderBundle } = await createPrincipalPolicyBundle();
    const { bundle: newerBundle } =
      await createSuccessorPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(olderBundle);
    await savePrincipalPolicyBundle(
      execSql,
      olderBundle,
      "2026-04-08T00:00:00.000Z",
    );
    await loadPrincipalPolicyCheckpoint(execSql, "group", "group-1");
    await execSql(
      `INSERT INTO principal_policy_checkpoints
         (principal_type, principal_id, version, state_hash, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        "group",
        "group-1",
        newerBundle.currentState.version,
        newerBundle.currentState.stateHash,
        "2026-04-08T00:01:00.000Z",
      ],
    );

    await expect(
      filterUncachedPrincipalPolicyReferences({
        execSql,
        principalPolicyCache: EMPTY_CACHE,
        references: [reference],
      }),
    ).resolves.toEqual([reference]);
  } finally {
    close();
  }
});

test("principalPolicyBundleContainsReference requires every head field to match exactly", async () => {
  const { bundle } = await createPrincipalPolicyBundle();
  const head = referencedPrincipalStateFromBundle(
    bundle,
  ) as ReferencedPrincipalHead;

  expect(principalPolicyBundleContainsReference(bundle, head)).toBe(true);

  // Each individual field divergence must defeat the match — this is the
  // security-relevant tightening (a stale head must not be treated as cached).
  expect(
    principalPolicyBundleContainsReference(bundle, {
      ...head,
      version: head.version + 1,
    }),
  ).toBe(false);
  expect(
    principalPolicyBundleContainsReference(bundle, {
      ...head,
      keyEpoch: head.keyEpoch + 1,
    }),
  ).toBe(false);
  expect(
    principalPolicyBundleContainsReference(bundle, {
      ...head,
      stateHash: `${head.stateHash}-tampered`,
    }),
  ).toBe(false);
  expect(
    principalPolicyBundleContainsReference(bundle, {
      ...head,
      keyFingerprint: `${head.keyFingerprint}-tampered`,
    }),
  ).toBe(false);
});
