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
import type { createTestExecSql } from "@tearleads/test-utils";
import type { AccessManifestBundleWireResponse } from "@tearleads/validators/response";
import { createProjectionCheckpointContext } from "../../src/data/keyingProjectionVerification/checkpointContext";
import { verifyContainerManifestPath } from "../../src/data/keyingProjectionVerification/containerProjectionVerification";
import { principalPolicyCacheForVerifiedPolicies } from "../../src/data/keyingProjectionVerification/principalPolicyCache";
import { advanceKeyingCheckpointsAtomically } from "../../src/data/persistence/keyingCheckpointAdvancePersistence";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

// A child manifest pins the parent it was created under, and successors
// inherit that pin, so a member revoked from an ancestor could keep signing
// child events that verify against the manifest that still granted them.
// Every container event signs the ancestor heads it was committed against,
// so the verifier authorizes a head at those cited heads and refuses a head
// that cites an older ancestor head than an earlier signed statement proved.
// It does not yet require a head new to a device to cite the current heads;
// see #2166 for why that waits on descendants being able to re-cite.

export const ORGANIZATION_ID = "organization-1";
export const ROOT_ID = "ancestor-root";
const CHILD_ID = "ancestor-child";

export type Signer = {
  readonly keyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
  readonly userId: string;
};

export function manifestBundle(
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

export async function successor(input: {
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

export async function grantBy(input: {
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
    // The derived state keeps grants sorted by subject key.
    state: (previous) => ({
      directGrants: [...previous.directGrants, grant].sort((left, right) =>
        `${left.subjectType}:${left.subjectId}`.localeCompare(
          `${right.subjectType}:${right.subjectId}`,
        ),
      ),
    }),
  });
}

export async function createScenario() {
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

export function verifyPath(
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

export async function checkpointChildAt(
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

export async function createGrandchildScenario() {
  const scenario = await createScenario();
  // The child is created under root2, so its pin already proves root2.
  const middleBody: ContainerAccessEventBody = {
    eventType: "container.create",
    parentContainerId: ROOT_ID,
    parentManifestHash: scenario.root2.manifestHash,
    metadataDocumentId: "ancestor-middle-metadata-document",
    containerKeyEpochId: "middle-key-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const middle = await createContainerManifestFixture({
    containerId: "ancestor-middle",
    containerKeyEpochId: "middle-key-1",
    directGrants: [],
    event: await createVerifiedContainerAccessEvent({
      body: middleBody,
      dependencyManifestHashes: [scenario.root2.manifestHash],
      objectId: "ancestor-middle",
      organizationId: ORGANIZATION_ID,
      previousManifestHash: null,
      signer: scenario.alice.keyPair,
      signerUserId: scenario.alice.userId,
    }),
    organizationId: ORGANIZATION_ID,
    parentContainerId: ROOT_ID,
    parentManifestHash: scenario.root2.manifestHash,
    signer: scenario.alice.keyPair,
    signerUserId: scenario.alice.userId,
  });
  const leafBody: ContainerAccessEventBody = {
    eventType: "container.create",
    parentContainerId: middle.state.containerId,
    parentManifestHash: middle.manifestHash,
    metadataDocumentId: "ancestor-leaf-metadata-document",
    containerKeyEpochId: "leaf-key-1",
    directGrants: [],
    referencedPrincipalHeads: [],
  };
  const leaf = await createContainerManifestFixture({
    containerId: "ancestor-leaf",
    containerKeyEpochId: "leaf-key-1",
    directGrants: [],
    event: await createVerifiedContainerAccessEvent({
      body: leafBody,
      dependencyManifestHashes: [
        scenario.root2.manifestHash,
        middle.manifestHash,
      ],
      objectId: "ancestor-leaf",
      organizationId: ORGANIZATION_ID,
      previousManifestHash: null,
      signer: scenario.alice.keyPair,
      signerUserId: scenario.alice.userId,
    }),
    organizationId: ORGANIZATION_ID,
    parentContainerId: middle.state.containerId,
    parentManifestHash: middle.manifestHash,
    signer: scenario.alice.keyPair,
    signerUserId: scenario.alice.userId,
  });
  return { ...scenario, leaf, middle };
}

/** Records a verified root head as this device's local checkpoint for it. */
export async function checkpointRootAt(
  scenario: Scenario,
  execSql: Awaited<ReturnType<typeof createTestExecSql>>["execSql"],
  head: VerifiedContainerAccessManifest,
): Promise<void> {
  const [verifiedHead] = await verifyPath(scenario, execSql, {
    bundles: [scenario.root1, head],
    path: [head],
  });
  if (!verifiedHead) throw new Error("Expected the root head to verify");
  await advanceKeyingCheckpointsAtomically({
    access: [{ head: verifiedHead, predecessors: [] }],
    execSql,
    policies: [],
  });
}
