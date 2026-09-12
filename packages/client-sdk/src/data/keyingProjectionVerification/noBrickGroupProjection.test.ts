import { expect, test } from "bun:test";
import {
  type ContainerGrantPrincipalHead,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  createContainerManifestFixture,
  createPrincipalPolicyFixture,
  createVerifiedContainerAccessEvent,
  fixtureHash,
} from "@tearleads/crypto/test-fixtures";
import {
  createNativeTestExecSql,
  createNoBrickTraceRecorder,
  persistNoBrickTrace,
} from "@tearleads/test-utils";
import {
  grantBy,
  manifestBundle,
  successor,
} from "../../../test/helpers/ancestorCitationScenario";
import { createTestTrustedUserIdentity } from "../../../test/helpers/trustedUserIdentity";
import { advanceKeyingCheckpointsAtomically } from "../persistence/keyingCheckpointAdvancePersistence";
import { createProjectionCheckpointContext } from "./checkpointContext";
import { verifyContainerManifestPath } from "./containerPathVerification";
import { principalPolicyCacheForVerifiedPolicies } from "./principalPolicyCache";

test("a cold device accepts a child signed by a since-removed group admin", async () => {
  const alice = { userId: "alice", keyPair: generateSigningSeedAndKeyPair() };
  const mallory = {
    userId: "mallory",
    keyPair: generateSigningSeedAndKeyPair(),
  };
  const firstHead: ContainerGrantPrincipalHead = {
    principalType: "group",
    principalId: "historical-admins",
    version: 1,
    keyEpoch: 1,
    stateHash: await fixtureHash("historical-admins-1"),
    keyFingerprint: await fixtureHash("historical-admins-key-1"),
  };
  const currentHead = {
    ...firstHead,
    version: 2,
    keyEpoch: 2,
    stateHash: await fixtureHash("historical-admins-2"),
    keyFingerprint: await fixtureHash("historical-admins-key-2"),
  };
  const policy = {
    ...createPrincipalPolicyFixture(currentHead),
    projection: [{ role: "admin", userId: alice.userId }],
    history: [
      {
        grants: [],
        projection: [{ role: "admin", userId: mallory.userId }],
        state: firstHead,
      },
      {
        grants: [],
        projection: [{ role: "admin", userId: alice.userId }],
        state: currentHead,
      },
    ],
  } as unknown as VerifiedPrincipalPolicy;
  const root1 = await createContainerManifestFixture({
    containerId: "group-root",
    containerKeyEpochId: "group-root-key-1",
    directGrants: [
      {
        accessLevel: "admin",
        subjectType: "group",
        subjectId: firstHead.principalId,
      },
      { accessLevel: "admin", subjectType: "user", subjectId: alice.userId },
    ],
    referencedPrincipalHeads: [firstHead],
    signer: alice.keyPair,
    signerUserId: alice.userId,
  });
  const child1 = await createContainerManifestFixture({
    containerId: "group-child",
    containerKeyEpochId: "group-child-key-1",
    directGrants: [],
    event: await createVerifiedContainerAccessEvent({
      body: {
        eventType: "container.create",
        parentContainerId: root1.state.containerId,
        parentManifestHash: root1.manifestHash,
        metadataDocumentId: "group-child-metadata-document",
        containerKeyEpochId: "group-child-key-1",
        directGrants: [],
        referencedPrincipalHeads: [],
      },
      dependencyManifestHashes: [root1.manifestHash],
      objectId: "group-child",
      organizationId: "organization-1",
      previousManifestHash: null,
      signer: alice.keyPair,
      signerUserId: alice.userId,
    }),
    parentContainerId: root1.state.containerId,
    parentManifestHash: root1.manifestHash,
    signer: alice.keyPair,
    signerUserId: alice.userId,
  });
  const child2 = await grantBy({
    cited: [root1.manifestHash, child1.manifestHash],
    previous: child1,
    signer: mallory,
    subjectId: "reader",
  });
  const root2 = await successor({
    body: {
      eventType: "container.rekey",
      containerKeyEpochId: "group-root-key-2",
      keyringHash: await fixtureHash("group-root-keyring"),
      predecessorBridgeHash: await fixtureHash("group-root-bridge"),
      referencedPrincipalHeads: [currentHead],
    },
    cited: [root1.manifestHash],
    previous: root1,
    signer: alice,
    state: () => ({
      containerKeyEpochId: "group-root-key-2",
      referencedPrincipalHeads: [currentHead],
    }),
  });
  const bundles = [root1, root2, child1, child2].map(manifestBundle);
  const { close, execSql } = createNativeTestExecSql();
  const recorder = createNoBrickTraceRecorder("container-group-late-delivery", {
    d1: 0,
  });
  recorder.record({ action: "CommitDependent", late: true });
  recorder.record({ action: "RevokeLateSigner" });
  try {
    const verifiedByHash = new Map<string, VerifiedContainerAccessManifest>();
    const verificationInput = {
      servedAsCurrent: true,
      bundlesByHash: new Map(
        bundles.map((bundle) => [bundle.manifestHash, bundle]),
      ),
      checkpointContext: createProjectionCheckpointContext({ execSql }),
      enforceLocalCheckpoints: true,
      label: "Late group-authored child",
      path: [root2, child2].map(manifestBundle),
      principalPolicyCache: principalPolicyCacheForVerifiedPolicies([policy]),
      resolveUserKey: async (userId) => {
        const signer = [alice, mallory].find(
          (entry) => entry.userId === userId,
        );
        return signer
          ? createTestTrustedUserIdentity({
              signingKeyFingerprint: await toFingerprint(
                signer.keyPair.signingPublicKey,
              ),
              signingPublicKey: signer.keyPair.signingPublicKey,
              userId,
            })
          : null;
      },
      verifiedByHash,
    } satisfies Parameters<typeof verifyContainerManifestPath>[0];
    const path = await verifyContainerManifestPath(verificationInput);
    await advanceKeyingCheckpointsAtomically({
      access: path.map((head) => ({
        head,
        predecessors: [...verifiedByHash.values()]
          .filter(
            (entry) =>
              entry.state.containerId === head.state.containerId &&
              entry.state.epoch < head.state.epoch,
          )
          .sort((left, right) => left.state.epoch - right.state.epoch),
      })),
      execSql,
      policies: [],
    });
    recorder.record({
      action: "HonestSync",
      device: "d1",
      observed: { outcome: "accepted" },
    });
    expect(path.at(-1)?.manifestHash).toBe(child2.manifestHash);
    const forged = await grantBy({
      cited: [root2.manifestHash, child2.manifestHash],
      previous: child2,
      signer: mallory,
      subjectId: "forged-reader",
    });
    await expect(
      verifyContainerManifestPath({
        ...verificationInput,
        bundlesByHash: new Map(
          [...bundles, manifestBundle(forged)].map((bundle) => [
            bundle.manifestHash,
            bundle,
          ]),
        ),
        path: [root2, forged].map(manifestBundle),
        verifiedByHash: new Map(),
      }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    recorder.record({
      action: "Verify",
      device: "d1",
      projection: {
        authority: root2.state.epoch,
        cited: root2.state.epoch,
        head: forged.state.epoch,
        honestPrefix: child2.state.epoch,
        late: true,
      },
      observed: { outcome: "refused" },
    });
    persistNoBrickTrace(recorder.trace());
  } finally {
    close();
  }
});
