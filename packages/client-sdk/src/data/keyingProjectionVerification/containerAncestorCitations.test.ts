import { expect, test } from "bun:test";
import type {
  ContainerAccessEventBody,
  ContainerAccessManifestState,
  VerifiedContainerAccessManifest,
} from "@tearleads/crypto";
import {
  computeAccessManifestHash,
  deriveContainerAccessManifest,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import {
  createContainerManifestFixture,
  createVerifiedContainerAccessEvent,
  fixtureHash,
} from "@tearleads/crypto/test-fixtures";
import { createTestExecSql } from "@tearleads/test-utils";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "./principalPolicyCache";

// A child manifest pins the parent it was created under, and successors
// inherit that pin, so a member revoked from an ancestor could keep signing
// child events that verify against the manifest that still granted them.
// Every container event signs the ancestor heads it was committed against,
// so the verifier authorizes a head at those cited heads, refuses a head that
// is new to this device unless it cites the served current heads, and refuses
// a head that cites an older parent head than its predecessor did.

const ORGANIZATION_ID = "organization-1";
const ROOT_ID = "ancestor-root";
const CHILD_ID = "ancestor-child";

type Signer = {
  readonly keyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly userId: string;
};

function manifestBundle(
  value: VerifiedContainerAccessManifest,
): AccessManifestBundleWireResponse {
  return {
    event: {
      body: value.event.body,
      event: value.event.event,
      eventHash: value.event.eventHash,
    },
    manifest: value.manifest,
    manifestHash: value.manifestHash,
    state: value.state,
  } as unknown as AccessManifestBundleWireResponse;
}

async function successor(input: {
  readonly body: ContainerAccessEventBody;
  readonly cited: readonly string[];
  readonly previous: VerifiedContainerAccessManifest;
  readonly signer: Signer;
  readonly state: (
    previous: ContainerAccessManifestState,
  ) => Partial<ContainerAccessManifestState>;
}): Promise<VerifiedContainerAccessManifest> {
  const event = await createVerifiedContainerAccessEvent({
    body: input.body,
    dependencyManifestHashes: input.cited,
    objectId: input.previous.state.containerId,
    organizationId: ORGANIZATION_ID,
    previousManifestHash: input.previous.manifestHash,
    signer: input.signer.keyPair,
    signerUserId: input.signer.userId,
  });
  const state: ContainerAccessManifestState = {
    ...input.previous.state,
    ...input.state(input.previous.state),
    epoch: input.previous.state.epoch + 1,
    eventHash: event.eventHash,
    previousManifestHash: input.previous.manifestHash,
  };
  const manifest = await deriveContainerAccessManifest(state);
  return {
    event,
    manifest,
    manifestHash: await computeAccessManifestHash(manifest),
    state,
  } as VerifiedContainerAccessManifest;
}

async function grantBy(input: {
  readonly cited: readonly string[];
  readonly previous: VerifiedContainerAccessManifest;
  readonly signer: Signer;
  readonly subjectId: string;
}): Promise<VerifiedContainerAccessManifest> {
  const grant = {
    accessLevel: "admin" as const,
    subjectId: input.subjectId,
    subjectType: "user" as const,
  };
  return successor({
    body: {
      eventType: "container.grant",
      containerKeyEpochId: input.previous.state.containerKeyEpochId,
      grant,
      referencedPrincipalHead: null,
    },
    cited: input.cited,
    previous: input.previous,
    signer: input.signer,
    state: (previous) => ({ directGrants: [...previous.directGrants, grant] }),
  });
}

async function createScenario() {
  const alice: Signer = {
    keyPair: generateSigningSeedAndKeyPair(),
    userId: "alice",
  };
  const mallory: Signer = {
    keyPair: generateSigningSeedAndKeyPair(),
    userId: "mallory",
  };
  const root1 = await createContainerManifestFixture({
    containerId: ROOT_ID,
    containerKeyEpochId: "root-key-1",
    directGrants: [
      { accessLevel: "admin", subjectId: alice.userId, subjectType: "user" },
      { accessLevel: "admin", subjectId: mallory.userId, subjectType: "user" },
    ],
    organizationId: ORGANIZATION_ID,
    signer: alice.keyPair,
    signerUserId: alice.userId,
  });
  // Alice revokes Mallory at the root; Mallory keeps root1's contents.
  const root2 = await successor({
    body: {
      eventType: "container.revoke",
      containerKeyEpochId: "root-key-2",
      keyringHash: await fixtureHash("ancestor-root-keyring"),
      predecessorBridgeHash: await fixtureHash("ancestor-root-bridge"),
      subjectId: mallory.userId,
      subjectType: "user",
    },
    cited: [root1.manifestHash],
    previous: root1,
    signer: alice,
    state: (previous) => ({
      containerKeyEpochId: "root-key-2",
      directGrants: previous.directGrants.filter(
        (grant) => grant.subjectId !== mallory.userId,
      ),
    }),
  });
  const childBody: ContainerAccessEventBody = {
    eventType: "container.create",
    parentContainerId: ROOT_ID,
    parentManifestHash: root1.manifestHash,
    metadataDocumentId: `${CHILD_ID}-metadata-document`,
    containerKeyEpochId: "child-key-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const child1 = await createContainerManifestFixture({
    containerId: CHILD_ID,
    containerKeyEpochId: "child-key-1",
    directGrants: [],
    event: await createVerifiedContainerAccessEvent({
      body: childBody,
      dependencyManifestHashes: [root1.manifestHash],
      objectId: CHILD_ID,
      organizationId: ORGANIZATION_ID,
      previousManifestHash: null,
      signer: alice.keyPair,
      signerUserId: alice.userId,
    }),
    organizationId: ORGANIZATION_ID,
    parentContainerId: ROOT_ID,
    parentManifestHash: root1.manifestHash,
    signer: alice.keyPair,
    signerUserId: alice.userId,
  });
  const fingerprints = new Map<string, Signer>([
    [alice.userId, alice],
    [mallory.userId, mallory],
  ]);
  const resolveUserKey = async (userId: string) => {
    const signer = fingerprints.get(userId);
    return signer
      ? createTestTrustedUserIdentity({
          signingKeyFingerprint: await toFingerprint(
            signer.keyPair.signingPublicKey,
          ),
          signingPublicKey: signer.keyPair.signingPublicKey,
          userId,
        })
      : null;
  };
  return { alice, child1, mallory, resolveUserKey, root1, root2 };
}

type Scenario = Awaited<ReturnType<typeof createScenario>>;

function verifyPath(
  scenario: Scenario,
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  input: {
    readonly bundles: readonly VerifiedContainerAccessManifest[];
    readonly path: readonly VerifiedContainerAccessManifest[];
  },
) {
  return verifyContainerManifestPath({
    bundlesByHash: new Map(
      input.bundles.map((value) => [value.manifestHash, manifestBundle(value)]),
    ),
    checkpointContext: createProjectionCheckpointContext({ execSql }),
    enforceLocalCheckpoints: true,
    label: "Ancestor citation path",
    path: input.path.map(manifestBundle),
    principalPolicyCache: principalPolicyCacheForVerifiedPolicies([]),
    resolveUserKey: scenario.resolveUserKey,
    verifiedByHash: new Map(),
  });
}

async function checkpointChildAt(
  scenario: Scenario,
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  head: VerifiedContainerAccessManifest,
  bundles: readonly VerifiedContainerAccessManifest[],
): Promise<void> {
  // Verify the head once so it carries checkpoint evidence, then record it
  // as this device's local checkpoint for the child.
  const [, verifiedHead] = await verifyPath(scenario, execSql, {
    bundles,
    path: [scenario.root1, head],
  });
  if (!verifiedHead) throw new Error("Expected the child head to verify");
  await advanceKeyingCheckpointsAtomically({
    access: [{ head: verifiedHead, predecessors: [] }],
    execSql,
    policies: [],
  });
}

test("a device with no checkpoint accepts a head at the ancestor heads it cites", async () => {
  const scenario = await createScenario();
  // Signed while root1 was current, which is what its citation says.
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-cold");
  try {
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
      path: [scenario.root2, child2],
    });
    expect(verified.map((manifest) => manifest.manifestHash)).toEqual([
      scenario.root2.manifestHash,
      child2.manifestHash,
    ]);
  } finally {
    close();
  }
});

test("a head new to a device that checkpointed the child must cite the current ancestor heads", async () => {
  const scenario = await createScenario();
  const forged = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-warm");
  try {
    await checkpointChildAt(scenario, execSql, scenario.child1, [
      scenario.root1,
      scenario.child1,
    ]);
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1, forged],
        path: [scenario.root2, forged],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("no longer current"),
    });
    // The same event citing the served head is what an honest client
    // commits after refetching.
    const current = await grantBy({
      cited: [scenario.root2.manifestHash, scenario.child1.manifestHash],
      previous: scenario.child1,
      signer: scenario.alice,
      subjectId: "bob",
    });
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.child1, current],
      path: [scenario.root2, current],
    });
    expect(verified).toHaveLength(2);
  } finally {
    close();
  }
});

test("a head already checkpointed keeps verifying after its ancestor moved on", async () => {
  const scenario = await createScenario();
  const child2 = await grantBy({
    cited: [scenario.root1.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-seen");
  try {
    await checkpointChildAt(scenario, execSql, child2, [
      scenario.root1,
      scenario.child1,
      child2,
    ]);
    const verified = await verifyPath(scenario, execSql, {
      bundles: [scenario.root1, scenario.root2, scenario.child1, child2],
      path: [scenario.root2, child2],
    });
    expect(verified).toHaveLength(2);
  } finally {
    close();
  }
});

test("a head must not cite an older parent head than its predecessor cited", async () => {
  const scenario = await createScenario();
  const child2 = await grantBy({
    cited: [scenario.root2.manifestHash, scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  // child2 proved root2 predates it; a later head citing root1 is a rollback
  // even for a device with no checkpoint.
  const forged = await grantBy({
    cited: [scenario.root1.manifestHash, child2.manifestHash],
    previous: child2,
    signer: scenario.mallory,
    subjectId: scenario.mallory.userId,
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-regress");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [
          scenario.root1,
          scenario.root2,
          scenario.child1,
          child2,
          forged,
        ],
        path: [scenario.root2, forged],
      }),
    ).rejects.toMatchObject({
      code: "rollback",
      message: expect.stringContaining("older head"),
    });
  } finally {
    close();
  }
});

test("a head must cite a served head of its parent container", async () => {
  const scenario = await createScenario();
  const uncited = await grantBy({
    cited: [scenario.child1.manifestHash],
    previous: scenario.child1,
    signer: scenario.alice,
    subjectId: "bob",
  });
  const { close, execSql } = await createTestExecSql("ancestor-cites-missing");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1, uncited],
        path: [scenario.root2, uncited],
      }),
    ).rejects.toMatchObject({
      code: "missing_dependency",
      message: expect.stringContaining("parent container"),
    });
  } finally {
    close();
  }
});

test("a served path must be a root-to-leaf ancestor chain", async () => {
  const scenario = await createScenario();
  const { close, execSql } = await createTestExecSql("ancestor-cites-chain");
  try {
    await expect(
      verifyPath(scenario, execSql, {
        bundles: [scenario.root1, scenario.root2, scenario.child1],
        path: [scenario.child1, scenario.root2],
      }),
    ).rejects.toMatchObject({
      code: "object_mismatch",
      message: expect.stringContaining("parent container"),
    });
  } finally {
    close();
  }
});
