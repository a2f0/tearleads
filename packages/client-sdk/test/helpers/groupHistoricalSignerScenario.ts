import {
  type ContainerGrantPrincipalHead,
  computeContainerKekMaterialId,
  deriveContainerKekRecipientTargets,
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
  type VerifiedContainerAccessManifest,
  type VerifiedContainerKekState,
  type VerifiedDocumentLinkSetManifest,
  type VerifiedPrincipalPolicy,
  verifyContainerKekState,
} from "@tearleads/crypto";
import {
  containerWrappingPublicKeyForTest,
  createContainerKeyEpochFixture,
  createContainerKeyWrap,
  createContainerManifestFixture,
  createDocumentLinkSetManifestFixture,
  createPrincipalPolicyFixture,
  createVerifiedContainerAccessEvent,
  createVerifiedDocumentAccessEvent,
  fixtureHash,
} from "@tearleads/crypto/test-fixtures";
import type {
  ContainerKekResponse,
  ContainerWriterProjectionResponse,
  DocumentWriterProjectionResponse,
} from "@tearleads/validators/response";
import {
  grantBy,
  manifestBundle,
  ORGANIZATION_ID,
  type Signer,
  successor,
} from "./ancestorCitationScenario";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

// A group admin signs a child head and a document link, then is removed from
// the group; the root adopts the successor policy. A cold device receives the
// root's current head with the child and document heads still citing the
// root head that referenced the earlier group version. The honest API
// committed those heads, so the client must authorize their signer at the
// group membership the cited head referenced, not at the served policy.

const GROUP_ROOT_ID = "group-root";
const GROUP_CHILD_ID = "group-child";
const GROUP_DOCUMENT_ID = "group-document";

interface Participant extends Signer {
  readonly kem: ReturnType<typeof generateKemSeedAndKeyPair>;
}

function participant(userId: string): Participant {
  return {
    kem: generateKemSeedAndKeyPair(),
    keyPair: generateSigningSeedAndKeyPair(),
    userId,
  };
}

function materialId(containerId: string, keyEpoch: number) {
  return computeContainerKekMaterialId({
    containerId,
    keyEpoch,
    keyMaterial: crypto.getRandomValues(new Uint8Array(32)),
  });
}

async function groupPolicy(input: {
  readonly former: Participant;
  readonly remaining: Participant;
}) {
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
  const remaining = [{ role: "admin", userId: input.remaining.userId }];
  // Persisted policy checkpoints compare against the signed state, so it
  // carries the full head rather than the fixture's key fingerprint alone.
  const policy = {
    ...createPrincipalPolicyFixture(currentHead),
    projection: remaining,
    state: currentHead,
    history: [
      {
        grants: [],
        projection: [{ role: "admin", userId: input.former.userId }],
        state: firstHead,
      },
      { grants: [], projection: remaining, state: currentHead },
    ],
  } as unknown as VerifiedPrincipalPolicy;
  return { currentHead, firstHead, policy };
}

export async function createGroupHistoricalSignerScenario() {
  const alice = participant("alice");
  const mallory = participant("mallory");
  const reader = participant("reader");
  const peer = participant("peer");
  const { currentHead, firstHead, policy } = await groupPolicy({
    former: mallory,
    remaining: alice,
  });
  const rootKeyEpochIds = [
    await materialId(GROUP_ROOT_ID, 1),
    await materialId(GROUP_ROOT_ID, 2),
  ] as const;
  const childKeyEpochId = await materialId(GROUP_CHILD_ID, 1);
  const root1 = await createContainerManifestFixture({
    containerId: GROUP_ROOT_ID,
    containerKeyEpochId: rootKeyEpochIds[0],
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
    containerId: GROUP_CHILD_ID,
    containerKeyEpochId: childKeyEpochId,
    directGrants: [],
    event: await createVerifiedContainerAccessEvent({
      body: {
        containerKeyPublicKey:
          containerWrappingPublicKeyForTest(childKeyEpochId),
        systemSlot: null,
        eventType: "container.create",
        parentContainerId: root1.state.containerId,
        parentManifestHash: root1.manifestHash,
        metadataDocumentId: `${GROUP_CHILD_ID}-metadata-document`,
        containerKeyEpochId: childKeyEpochId,
        directGrants: [],
        referencedPrincipalHeads: [],
      },
      dependencyManifestHashes: [root1.manifestHash],
      objectId: GROUP_CHILD_ID,
      organizationId: ORGANIZATION_ID,
      previousManifestHash: null,
      signer: alice.keyPair,
      signerUserId: alice.userId,
    }),
    parentContainerId: root1.state.containerId,
    parentManifestHash: root1.manifestHash,
    signer: alice.keyPair,
    signerUserId: alice.userId,
  });
  // Mallory, still a group admin at the head she cites, grants the reader.
  const child2 = await grantBy({
    cited: [root1.manifestHash, child1.manifestHash],
    previous: child1,
    signer: mallory,
    subjectId: reader.userId,
  });
  // The root adopts the group successor that removed Mallory.
  const root2 = await successor({
    body: {
      containerKeyPublicKey: containerWrappingPublicKeyForTest(
        rootKeyEpochIds[1],
      ),
      eventType: "container.rekey",
      containerKeyEpochId: rootKeyEpochIds[1],
      keyringHash: await fixtureHash("group-root-keyring"),
      predecessorBridgeHash: await fixtureHash("group-root-bridge"),
      referencedPrincipalHeads: [currentHead],
    },
    cited: [root1.manifestHash],
    previous: root1,
    signer: alice,
    state: () => ({
      containerKeyEpochId: rootKeyEpochIds[1],
      referencedPrincipalHeads: [currentHead],
    }),
  });
  const participants = [alice, mallory, peer, reader];
  const resolveUserKey = async (userId: string) => {
    const signer = participants.find((entry) => entry.userId === userId);
    return signer
      ? createTestTrustedUserIdentity({
          encapsulationPublicKey: signer.kem.publicKey,
          signingKeyFingerprint: await toFingerprint(
            signer.keyPair.signingPublicKey,
          ),
          signingPublicKey: signer.keyPair.signingPublicKey,
          userId,
        })
      : null;
  };
  return {
    alice,
    child1,
    child2,
    mallory,
    participants,
    peer,
    policy,
    reader,
    resolveUserKey,
    root1,
    root2,
  };
}

export type GroupHistoricalSignerScenario = Awaited<
  ReturnType<typeof createGroupHistoricalSignerScenario>
>;

async function userRecipientKeys(
  manifest: VerifiedContainerAccessManifest,
  participants: readonly Participant[],
) {
  return Promise.all(
    manifest.state.directGrants
      .filter((grant) => grant.subjectType === "user")
      .map(async (grant) => {
        const user = participants.find(
          (entry) => entry.userId === grant.subjectId,
        );
        if (!user) throw new Error(`No recipient key for ${grant.subjectId}`);
        const fingerprint = await toFingerprint(user.kem.publicKey);
        return {
          recipientKeyEpochId: `user:${user.userId}:encapsulation:${fingerprint}`,
          recipientKeyFingerprint: fingerprint,
          userId: user.userId,
        };
      }),
  );
}

/**
 * A served KEK entry whose wraps cover exactly the targets the head's grants
 * derive. The verifier does not open the wraps or the keyring, so their
 * material is a placeholder; every hash and binding it checks is real.
 */
async function kekResponse(input: {
  readonly createdBy: VerifiedContainerAccessManifest;
  readonly head: VerifiedContainerAccessManifest;
  readonly history: readonly VerifiedContainerAccessManifest[];
  readonly keyEpoch: number;
  readonly parent: VerifiedContainerKekState | null;
  readonly scenario: GroupHistoricalSignerScenario;
}): Promise<{
  response: ContainerKekResponse;
  state: VerifiedContainerKekState;
}> {
  const keyEpoch = await createContainerKeyEpochFixture({
    createdByManifest: input.createdBy,
    keyEpoch: input.keyEpoch,
    manifest: input.head,
    parentContainerKeyEpochId: input.parent?.containerKeyEpochId ?? null,
  });
  const recipientKeys = await userRecipientKeys(
    input.head,
    input.scenario.participants,
  );
  const targets = deriveContainerKekRecipientTargets({
    containerManifest: input.head,
    parentKekState: input.parent,
    principalPolicies: [input.scenario.policy],
    userRecipientKeys: recipientKeys,
  });
  if (!targets.ok) throw targets.error;
  const wraps = await Promise.all(
    targets.value.map((target) =>
      createContainerKeyWrap({
        ...target,
        containerKeyEpochId: keyEpoch.id,
        wrapManifestHash: input.head.manifestHash,
      }),
    ),
  );
  const verified = await verifyContainerKekState({
    containerManifest: input.head,
    containerManifestHistory: input.history,
    keyEpoch,
    parentKekState: input.parent,
    principalPolicies: [input.scenario.policy],
    userRecipientKeys: recipientKeys,
    wraps,
  });
  if (!verified.ok) throw verified.error;
  return {
    response: {
      ...verified.value,
      containerManifestHistory: input.history.map(manifestBundle),
      keyring: null,
    } as unknown as ContainerKekResponse,
    state: verified.value,
  };
}

/** The child's writer projection as the API serves it for a given head. */
export async function childWriterProjection(
  scenario: GroupHistoricalSignerScenario,
  served: {
    readonly head: VerifiedContainerAccessManifest;
    readonly history: readonly VerifiedContainerAccessManifest[];
  } = { head: scenario.child2, history: [scenario.child1] },
): Promise<ContainerWriterProjectionResponse> {
  const root = await kekResponse({
    createdBy: scenario.root2,
    head: scenario.root2,
    history: [scenario.root1],
    keyEpoch: 2,
    parent: null,
    scenario,
  });
  const child = await kekResponse({
    createdBy: scenario.child1,
    head: served.head,
    history: served.history,
    keyEpoch: 1,
    parent: root.state,
    scenario,
  });
  return {
    containerId: served.head.state.containerId,
    containerKeks: [root.response, child.response],
    organizationId: ORGANIZATION_ID,
    path: [scenario.root2, served.head].map(manifestBundle),
  };
}

export async function linkDocument(input: {
  readonly cited: readonly VerifiedContainerAccessManifest[];
  readonly previous: VerifiedDocumentLinkSetManifest | null;
  readonly signer: Signer;
  readonly target: VerifiedContainerAccessManifest;
}): Promise<VerifiedDocumentLinkSetManifest> {
  const event = await createVerifiedDocumentAccessEvent({
    body: {
      eventType: "document.link",
      blobRewraps: [],
      containerId: input.target.state.containerId,
      containerManifestHash: input.target.manifestHash,
    },
    dependencyManifestHashes: input.cited.map((cited) => cited.manifestHash),
    objectId: GROUP_DOCUMENT_ID,
    organizationId: ORGANIZATION_ID,
    previousManifestHash: input.previous?.manifestHash ?? null,
    signer: input.signer.keyPair,
    signerUserId: input.signer.userId,
  });
  return createDocumentLinkSetManifestFixture({
    documentId: GROUP_DOCUMENT_ID,
    epoch: (input.previous?.state.epoch ?? 0) + 1,
    event,
    linkedContainerIds: [
      ...(input.previous?.state.linkedContainerIds ?? []),
      input.target.state.containerId,
    ],
    organizationId: ORGANIZATION_ID,
    previousManifestHash: input.previous?.manifestHash ?? null,
  });
}

/**
 * The document's writer projection: the head, its history newest first, the
 * root head each link cited, and the child's current authorizing path. The
 * verifier reads only this manifest evidence; the key bundle and KEK targets
 * are unwrapped by a later pass and are not modelled here.
 */
export async function documentWriterProjection(
  scenario: GroupHistoricalSignerScenario,
  manifests: readonly VerifiedDocumentLinkSetManifest[],
): Promise<DocumentWriterProjectionResponse> {
  const [head, ...history] = [...manifests].reverse();
  if (!head) throw new Error("A document projection needs a head");
  const authorizing = await childWriterProjection(scenario);
  return {
    authorizingContainerPaths: [authorizing],
    documentContainerManifestHistory: [
      scenario.root1,
      scenario.root2,
      scenario.child1,
      scenario.child2,
    ].map(manifestBundle),
    documentId: GROUP_DOCUMENT_ID,
    documentManifest: manifestBundle(head),
    documentManifestContainerPaths: [[manifestBundle(scenario.root1)]],
    documentManifestHistory: history.map(manifestBundle),
  } as unknown as DocumentWriterProjectionResponse;
}
