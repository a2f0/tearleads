import { db } from "@symcrypt/api-shared/postgres";
import type { TestUser } from "@symcrypt/bob-and-alice";
import type {
  ContainerAccessEventBody,
  ContainerGrantPrincipalHead,
  PrincipalContainerGrant,
  VerifiedPrincipalPolicy,
} from "@symcrypt/crypto";
import {
  computePrincipalStateHash,
  derivePrincipalRecipientKeyEpochId,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  toFingerprint,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import type {
  ContainerMutationRequest,
  PutPrincipalPolicyRequest,
} from "@symcrypt/validators/request";
import {
  isCommitOrganizationGroupPolicyResponse,
  isCreateOrganizationGroupResponse,
} from "@symcrypt/validators/response";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";
import { buildRootContainerRekeyMutation } from "./containerRekey";
import {
  accessManifestFromContainerResponse,
  asVerifiedContainerManifest,
  createContainerManifestBundle,
  createSignedAccessEvent,
  kekStateFromContainerResponse,
  uniquePrincipalPolicies,
  userRecipientKeysFromKekTargets,
} from "./keyingWriterProjectionKit";
import { buildRootRevokeRequest } from "./keyingWriterProjectionRevoke";
import { createGroupRequest } from "./organizationGroup";
import { joinOrg } from "./organizationMembership";
import { createPrincipalMemberEnvelopes } from "./principalMemberEnvelopes";
import {
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
} from "./principalPolicy";
import { signPrincipalStateBundle } from "./principalState";
import type { DecryptableStoredRootFixture } from "./registeredRootKek";

interface SignedGroupSuccessor {
  readonly policy: VerifiedPrincipalPolicy;
  readonly request: PutPrincipalPolicyRequest;
}

async function signGroupSuccessor(input: {
  actor: TestUser;
  current: VerifiedPrincipalPolicy;
  grants: readonly PrincipalContainerGrant[];
  projection?: VerifiedPrincipalPolicy["projection"];
}): Promise<SignedGroupSuccessor> {
  const principalKem = generateKemSeedAndKeyPair();
  const projection = input.projection ?? input.current.projection;
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });
  const signed = await signPrincipalStateBundle({
    principalType: "group",
    principalId: input.current.principalId,
    version: input.current.version + 1,
    prevStateHash: input.current.stateHash,
    keyEpoch: input.current.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    grants: [...input.grants],
    memberEnvelopes,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(JSON.stringify({ members: projection })),
    ),
    signedAt: new Date(
      Date.parse(input.current.state.signedAt) + 1_000,
    ).toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });
  const stateHash = await computePrincipalStateHash(signed.state);
  const nextState = {
    ...signed.state,
    stateHash,
    createdAt: signed.state.signedAt,
  };
  const policy = makeVerifiedPrincipalPolicy({
    principalType: "group",
    principalId: nextState.principalId,
    version: nextState.version,
    keyEpoch: nextState.keyEpoch,
    stateHash,
    state: nextState,
    projection: signed.projection,
    grants: signed.grants,
    history: [
      ...(input.current.history ?? [
        {
          state: input.current.state,
          projection: input.current.projection,
          grants: input.current.grants,
        },
      ]),
      {
        state: nextState,
        projection: signed.projection,
        grants: signed.grants,
      },
    ],
    checkpoint: {
      principalType: "group",
      principalId: nextState.principalId,
      version: nextState.version,
      stateHash,
    },
  });

  return {
    policy,
    request: {
      state: signed.state,
      encryptedPayload: signed.encryptedPayload,
      projection: signed.projection,
      grants: signed.grants,
      memberEnvelopes: signed.memberEnvelopes,
    },
  };
}

function principalHead(
  policy: VerifiedPrincipalPolicy,
): ContainerGrantPrincipalHead {
  return {
    principalType: "group",
    principalId: policy.principalId,
    version: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash: policy.stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  };
}

async function createManagedPrincipalWrap(input: {
  readonly containerKey: Uint8Array;
  readonly containerKeyEpochId: string;
  readonly policy: VerifiedPrincipalPolicy;
  readonly wrapManifestHash: string;
}) {
  const [wrapped] = await wrapDekForRecipients(input.containerKey, [
    base64ToBytes(input.policy.state.encapsulationPublicKey),
  ]);
  invariant(wrapped, "expected a managed-principal container wrap");
  const head = principalHead(input.policy);

  return {
    containerKeyEpochId: input.containerKeyEpochId,
    recipientKind: "group" as const,
    recipientId: head.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(head),
    recipientKeyFingerprint: wrapped.keyFingerprint,
    kemCipherText: bytesToBase64(wrapped.kemCipherText),
    wrappedKey: bytesToBase64(wrapped.wrappedKey),
    wrapManifestHash: input.wrapManifestHash,
  };
}

async function buildGroupGrantMutation(input: {
  accessLevel: "read" | "write";
  actor: TestUser;
  policy: VerifiedPrincipalPolicy;
  root: DecryptableStoredRootFixture;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.root.bundle);
  const reference = principalHead(input.policy);
  const grant = {
    accessLevel: input.accessLevel,
    subjectId: reference.principalId,
    subjectType: "group" as const,
  };
  const body: ContainerAccessEventBody = {
    eventType: "container.grant",
    containerKeyEpochId: previous.state.containerKeyEpochId,
    grant,
    referencedPrincipalHead: reference,
  };
  const event = await createSignedAccessEvent({
    body,
    dependencyManifestHashes: [input.root.bundle.manifestHash],
    objectId: previous.state.containerId,
    objectKind: "container",
    organizationId: previous.state.organizationId,
    previousManifestHash: input.root.bundle.manifestHash,
    signer: input.actor,
  });
  const bundle = await createContainerManifestBundle(
    {
      ...previous.state,
      epoch: previous.state.epoch + 1,
      previousManifestHash: input.root.bundle.manifestHash,
      eventHash: event.eventHash,
      directGrants: [...previous.state.directGrants, grant],
      referencedPrincipalHeads: [
        ...previous.state.referencedPrincipalHeads,
        reference,
      ],
    },
    event,
  );
  return {
    event: event.event as unknown as Record<string, unknown>,
    body: body as unknown,
    expectedManifestHash: bundle.manifestHash,
    manifest: bundle.manifest,
    previousManifest: input.root.bundle,
    previousContainerPath: [input.root.bundle],
    containerManifestHistory: [input.root.bundle],
    principalPolicies: uniquePrincipalPolicies([
      ...input.root.principalPolicies,
      input.policy,
    ]) as unknown as Record<string, unknown>[],
    keyEpoch: input.root.kekState.keyEpoch as unknown as Record<
      string,
      unknown
    >,
    keyring: null,
    predecessorBridge: null,
    wraps: [
      ...input.root.kekState.wraps,
      await createManagedPrincipalWrap({
        containerKey: input.root.plaintextKek,
        containerKeyEpochId: input.root.kekState.containerKeyEpochId,
        policy: input.policy,
        wrapManifestHash: bundle.manifestHash,
      }),
    ] as unknown as Record<string, unknown>[],
    parentKekState: null,
    userRecipientKeys: userRecipientKeysFromKekTargets(
      input.root.kekState,
    ) as unknown as Record<string, unknown>[],
  };
}

async function submitSuccessor(input: {
  actor: TestUser;
  containerMutation: ContainerMutationRequest;
  groupId: string;
  organizationId: string;
  successor: SignedGroupSuccessor;
}) {
  const response = await submitOrganizationGroupPolicyCommit({
    actor: input.actor,
    groupId: input.groupId,
    groupPolicy: {
      ...input.successor.request,
      containerMutations: [input.containerMutation],
    },
    organizationId: input.organizationId,
  });
  invariant(response.ok, await response.clone().text());
  const body: unknown = await response.json();
  invariant(
    isCommitOrganizationGroupPolicyResponse(body),
    "expected a compound group policy response",
  );
  const mutation = body.groupPolicy.containerMutations[0];
  invariant(mutation, "expected a dependent container mutation");
  return mutation;
}

async function rotateRootGroupPolicy(input: {
  readonly actor: TestUser;
  readonly groupId: string;
  readonly organizationId: string;
  readonly root: DecryptableStoredRootFixture;
  readonly successor: SignedGroupSuccessor;
}): Promise<DecryptableStoredRootFixture> {
  const rekey = await buildRootContainerRekeyMutation({
    previous: input.root,
    replacementPrincipalPolicy: input.successor.policy,
    signer: input.actor,
  });
  rekey.request.wraps = (await Promise.all(
    rekey.kekState.recipientTargets.map(async (target) => {
      invariant(
        target.recipientKind === "group",
        "expected root rekey recipients to be groups",
      );
      const policy = rekey.container.principalPolicies?.find(
        (candidate) =>
          candidate.principalType === target.recipientKind &&
          candidate.principalId === target.recipientId,
      );
      invariant(policy, "expected root rekey recipient policy");
      return createManagedPrincipalWrap({
        containerKey: rekey.plaintextKek,
        containerKeyEpochId: rekey.kekState.containerKeyEpochId,
        policy,
        wrapManifestHash: rekey.bundle.manifestHash,
      });
    }),
  )) as unknown as Record<string, unknown>[];
  const mutation = await submitSuccessor({
    actor: input.actor,
    containerMutation: rekey.request,
    groupId: input.groupId,
    organizationId: input.organizationId,
    successor: input.successor,
  });
  return {
    bundle: accessManifestFromContainerResponse(mutation),
    kekState: kekStateFromContainerResponse(mutation),
    plaintextKek: rekey.plaintextKek,
    principalPolicies: rekey.container.principalPolicies ?? [],
  };
}

export async function grantRootThroughRotatedReadGroup(input: {
  accessLevel?: "read" | "write";
  actor: TestUser;
  reader: TestUser;
  root: DecryptableStoredRootFixture;
}): Promise<{
  readonly groupId: string;
  readonly root: DecryptableStoredRootFixture;
}> {
  const organizationId = asVerifiedContainerManifest(input.root.bundle).state
    .organizationId;
  await joinOrg(organizationId, input.actor, input.reader);
  const groupId = crypto.randomUUID();
  const createResponse = await routeApp.request(
    `/organizations/${organizationId}/groups`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.actor.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(
        await createGroupRequest({
          actor: input.actor,
          additionalMembers: [input.reader],
          groupId,
          name: "Cold readers",
        }),
      ),
    },
  );
  invariant(createResponse.ok, await createResponse.clone().text());
  const created: unknown = await createResponse.json();
  invariant(
    isCreateOrganizationGroupResponse(created),
    "expected a created read group",
  );

  const initialPolicy = await loadVerifiedPrincipalPolicy(db, "group", groupId);
  const granted = await signGroupSuccessor({
    actor: input.actor,
    current: initialPolicy,
    grants: [
      {
        accessLevel: input.accessLevel ?? "read",
        containerId: input.root.kekState.containerId,
      },
    ],
  });
  const grantMutation = await submitSuccessor({
    actor: input.actor,
    containerMutation: await buildGroupGrantMutation({
      accessLevel: input.accessLevel ?? "read",
      actor: input.actor,
      policy: granted.policy,
      root: input.root,
    }),
    groupId,
    organizationId,
    successor: granted,
  });
  const grantedRoot: DecryptableStoredRootFixture = {
    bundle: accessManifestFromContainerResponse(grantMutation),
    kekState: kekStateFromContainerResponse(grantMutation),
    plaintextKek: input.root.plaintextKek,
    principalPolicies: uniquePrincipalPolicies([
      ...input.root.principalPolicies,
      granted.policy,
    ]),
  };

  const rotated = await signGroupSuccessor({
    actor: input.actor,
    current: granted.policy,
    grants: granted.policy.grants,
  });
  const rotatedRoot = await rotateRootGroupPolicy({
    actor: input.actor,
    groupId,
    organizationId,
    root: grantedRoot,
    successor: rotated,
  });
  return { groupId, root: rotatedRoot };
}

export async function revokeRootRotatedReadGroup(input: {
  readonly actor: TestUser;
  readonly groupId: string;
  readonly removedMemberUserId?: string;
  readonly root: DecryptableStoredRootFixture;
}): Promise<void> {
  const current = await loadVerifiedPrincipalPolicy(db, "group", input.groupId);
  const successor = await signGroupSuccessor({
    actor: input.actor,
    current,
    grants: [],
    projection: input.removedMemberUserId
      ? current.projection.filter(
          (member) => member.userId !== input.removedMemberUserId,
        )
      : current.projection,
  });
  const revoke = await buildRootRevokeRequest({
    previous: input.root.bundle,
    previousKekState: input.root.kekState,
    revokedGrant: {
      subjectId: input.groupId,
      subjectType: "group",
    },
    signer: input.actor,
  });
  revoke.principalPolicies = (revoke.principalPolicies ?? []).filter(
    (policy) => Reflect.get(policy, "principalId") !== input.groupId,
  );
  await submitSuccessor({
    actor: input.actor,
    containerMutation: revoke,
    groupId: input.groupId,
    organizationId: asVerifiedContainerManifest(input.root.bundle).state
      .organizationId,
    successor,
  });
}
