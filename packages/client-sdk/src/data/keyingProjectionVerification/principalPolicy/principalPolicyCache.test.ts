import { expect, test } from "bun:test";
import type {
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { makeVerifiedPrincipalPolicy } from "@tearleads/crypto";
import { createTestExecSql } from "@tearleads/test-utils";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  createPrincipalPolicyBundle,
  createSuccessorPrincipalPolicyBundle,
  referencedPrincipalStateFromBundle,
  referencedPrincipalStateFromPolicyState,
} from "../../../../test/helpers/data/principalPolicyBundles";
import { PIN_PRINCIPAL_POLICY_CHECKPOINT_SQL } from "../../../../test/helpers/data/principalPolicyCheckpointPins";
import { KeyingCheckpointRepository } from "../../persistence/keyingCheckpoints/keyingCheckpointRepository";
import {
  openPrincipalPolicyBundleReader,
  PrincipalPolicyBundleRepository,
} from "../../persistence/principalPolicy/principalPolicyBundleRepository";
import { principalPolicyBundleContainsReference } from "../../principalContracts/principalPolicyStates";
import {
  filterUncachedPrincipalPolicyReferences,
  referencedPrincipalPolicyKey,
} from "./principalPolicyCache";

const EMPTY_CACHE: ReadonlyMap<string, VerifiedPrincipalPolicy> = new Map();

function verifiedPolicyForBundle(
  bundle: Awaited<ReturnType<typeof createPrincipalPolicyBundle>>["bundle"],
): VerifiedPrincipalPolicy {
  return makeVerifiedPrincipalPolicy({
    checkpoint: {
      principalId: bundle.currentState.principalId,
      principalType: bundle.currentState.principalType,
      stateHash: bundle.currentState.stateHash,
      version: bundle.currentState.version,
    },
    history: [
      ...bundle.previousStates,
      {
        state: bundle.currentState,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
    ],
    keyEpoch: bundle.currentState.keyEpoch,
    principalId: bundle.currentState.principalId,
    principalType: bundle.currentState.principalType,
    projection: bundle.currentProjection,
    grants: bundle.currentGrants,
    state: bundle.currentState,
    stateHash: bundle.currentState.stateHash,
    version: bundle.currentState.version,
  });
}

function predecessorBundle(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicyBundleResponse {
  const previous = bundle.previousStates[0];
  if (!previous) {
    throw new Error("expected successor bundle to include a previous state");
  }
  return {
    currentMemberEnvelopes: {
      principalType: previous.state.principalType,
      principalId: previous.state.principalId,
      stateHash: previous.state.stateHash,
      epoch: previous.state.keyEpoch,
      envelopes: [],
    },
    currentPayload: {
      ciphertext: "cached-previous-ciphertext",
    },
    currentProjection: previous.projection,
    currentGrants: previous.grants,
    currentState: previous.state,
    previousStates: [],
  };
}

test("filterUncachedPrincipalPolicyReferences treats a reference with no stored bundle as uncached", async () => {
  const { close, execSql } = await createTestExecSql("principal-policy-cache");
  try {
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      openPrincipalPolicyBundleReader,
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
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(bundle, "org-1");

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      openPrincipalPolicyBundleReader,
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
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(bundle, "org-1");

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      openPrincipalPolicyBundleReader,
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
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(olderBundle, "org-1");
    const reference = referencedPrincipalStateFromBundle(newerBundle);

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      openPrincipalPolicyBundleReader,
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
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    const { bundle } = await createPrincipalPolicyBundle();
    const reference = referencedPrincipalStateFromBundle(bundle);
    const verifiedPolicy = verifiedPolicyForBundle(bundle);
    // Nothing is persisted; only the in-memory cache holds the key. A hit there
    // must short-circuit the storage lookup.
    const cache = new Map<string, VerifiedPrincipalPolicy>([
      [referencedPrincipalPolicyKey(reference), verifiedPolicy],
    ]);

    const uncached = await filterUncachedPrincipalPolicyReferences({
      execSql,
      openPrincipalPolicyBundleReader,
      principalPolicyCache: cache,
      references: [reference],
    });

    expect(uncached).toEqual([]);
  } finally {
    close();
  }
});

test("referencedPrincipalPolicyKey includes the exact epoch and key fingerprint", async () => {
  const { bundle } = await createPrincipalPolicyBundle();
  const reference = referencedPrincipalStateFromBundle(bundle);
  const exactKey = referencedPrincipalPolicyKey(reference);

  expect(
    referencedPrincipalPolicyKey({
      ...reference,
      keyEpoch: reference.keyEpoch + 1,
    }),
  ).not.toBe(exactKey);
  expect(
    referencedPrincipalPolicyKey({
      ...reference,
      keyFingerprint: `${reference.keyFingerprint}-different`,
    }),
  ).not.toBe(exactKey);
});

test("filterUncachedPrincipalPolicyReferences accepts an in-memory chain extending the durable pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-cache-memory-chain",
  );
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected successor bundle to include a previous state");
    }
    const reference = referencedPrincipalStateFromBundle(bundle);
    const cache = new Map<string, VerifiedPrincipalPolicy>([
      [
        referencedPrincipalPolicyKey(reference),
        verifiedPolicyForBundle(bundle),
      ],
    ]);
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await new KeyingCheckpointRepository(execSql).loadPrincipalPolicyCheckpoint(
      previousState.principalType,
      previousState.principalId,
    );
    await execSql(PIN_PRINCIPAL_POLICY_CHECKPOINT_SQL, [
      previousState.principalType,
      previousState.principalId,
      previousState.version,
      previousState.stateHash,
      "2026-04-08T00:01:00.000Z",
      "org-1",
    ]);

    await expect(
      filterUncachedPrincipalPolicyReferences({
        execSql,
        openPrincipalPolicyBundleReader,
        principalPolicyCache: cache,
        references: [reference],
      }),
    ).resolves.toEqual([]);
  } finally {
    close();
  }
});

test("filterUncachedPrincipalPolicyReferences rejects an in-memory chain that conflicts with the durable pin", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-cache-memory-chain-conflict",
  );
  try {
    const { bundle } = await createSuccessorPrincipalPolicyBundle();
    const previousState = bundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected successor bundle to include a previous state");
    }
    const reference = referencedPrincipalStateFromBundle(bundle);
    const cache = new Map<string, VerifiedPrincipalPolicy>([
      [
        referencedPrincipalPolicyKey(reference),
        verifiedPolicyForBundle(bundle),
      ],
    ]);
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).ensurePrincipalPolicyTables();
    await new KeyingCheckpointRepository(execSql).loadPrincipalPolicyCheckpoint(
      previousState.principalType,
      previousState.principalId,
    );
    await execSql(PIN_PRINCIPAL_POLICY_CHECKPOINT_SQL, [
      previousState.principalType,
      previousState.principalId,
      previousState.version,
      "f".repeat(64),
      "2026-04-08T00:01:00.000Z",
      "org-1",
    ]);

    await expect(
      filterUncachedPrincipalPolicyReferences({
        execSql,
        openPrincipalPolicyBundleReader,
        principalPolicyCache: cache,
        references: [reference],
      }),
    ).rejects.toMatchObject({
      code: "stale_predecessor",
      name: "KeyingVerificationError",
    });
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
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(olderBundle, "org-1");
    await new KeyingCheckpointRepository(execSql).loadPrincipalPolicyCheckpoint(
      "group",
      "group-1",
    );
    await execSql(PIN_PRINCIPAL_POLICY_CHECKPOINT_SQL, [
      "group",
      "group-1",
      newerBundle.currentState.version,
      newerBundle.currentState.stateHash,
      "2026-04-08T00:01:00.000Z",
      "org-1",
    ]);

    await expect(
      filterUncachedPrincipalPolicyReferences({
        execSql,
        openPrincipalPolicyBundleReader,
        principalPolicyCache: EMPTY_CACHE,
        references: [reference],
      }),
    ).resolves.toEqual([reference]);
  } finally {
    close();
  }
});

test("filterUncachedPrincipalPolicyReferences uses retained history ahead of the mutable current row", async () => {
  const { close, execSql } = await createTestExecSql(
    "principal-policy-cache-retained-ahead",
  );
  try {
    const { bundle: retainedBundle } =
      await createSuccessorPrincipalPolicyBundle();
    const currentBundle = predecessorBundle(retainedBundle);
    const previousState = retainedBundle.previousStates[0]?.state;
    if (!previousState) {
      throw new Error("expected retained bundle predecessor");
    }
    const retainedPolicy = verifiedPolicyForBundle(retainedBundle);
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).savePrincipalPolicyBundle(currentBundle, "org-1");
    await new PrincipalPolicyBundleRepository(
      execSql,
    ).retainVerifiedPrincipalPolicyBundle({
      organizationId: "org-1",
      bundle: retainedBundle,
      policy: retainedPolicy,
      updatedAt: "2026-04-08T00:01:00.000Z",
    });
    await new KeyingCheckpointRepository(
      execSql,
    ).advanceKeyingCheckpointsAtomically({
      organizationId: "org-1",
      access: [],
      policies: [retainedPolicy],
    });

    const reference = referencedPrincipalStateFromPolicyState(previousState);
    await expect(
      filterUncachedPrincipalPolicyReferences({
        execSql,
        openPrincipalPolicyBundleReader,
        principalPolicyCache: EMPTY_CACHE,
        references: [reference],
      }),
    ).resolves.toEqual([]);
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
