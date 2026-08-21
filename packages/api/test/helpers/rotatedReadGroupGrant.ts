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
} from "@symcrypt/crypto";
import { bytesToBase64 } from "@symcrypt/encoding";
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
  createContainerKeyWrapForRecipientTarget,
  createContainerManifestBundle,
  createSignedAccessEvent,
  kekStateFromContainerResponse,
  type StoredRootFixture,
  uniquePrincipalPolicies,
  userRecipientKeysFromKekTargets,
} from "./keyingWriterProjectionKit";
import { createGroupRequest } from "./organizationGroup";
import { joinOrg } from "./organizationMembership";
import { createPrincipalMemberEnvelopes } from "./principalMemberEnvelopes";
import {
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
} from "./principalPolicy";
import { signPrincipalStateBundle } from "./principalState";

interface SignedGroupSuccessor {
  readonly policy: VerifiedPrincipalPolicy;
  readonly request: PutPrincipalPolicyRequest;
}

async function signGroupSuccessor(input: {
  actor: TestUser;
  current: VerifiedPrincipalPolicy;
  grants: readonly PrincipalContainerGrant[];
}): Promise<SignedGroupSuccessor> {
  const principalKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection: input.current.projection,
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
    projection: input.current.projection,
    grants: [...input.grants],
    memberEnvelopes,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(
        JSON.stringify({ members: input.current.projection }),
      ),
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

async function buildReadGroupGrantMutation(input: {
  actor: TestUser;
  policy: VerifiedPrincipalPolicy;
  root: StoredRootFixture;
}): Promise<ContainerMutationRequest> {
  const previous = asVerifiedContainerManifest(input.root.bundle);
  const reference = principalHead(input.policy);
  const grant = {
    accessLevel: "read" as const,
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
  const recipientTarget = {
    recipientKind: "group" as const,
    recipientId: reference.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(reference),
    recipientKeyFingerprint: reference.keyFingerprint,
  };

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
      createContainerKeyWrapForRecipientTarget({
        containerKeyEpochId: input.root.kekState.containerKeyEpochId,
        recipientTarget,
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

export async function grantRootThroughRotatedReadGroup(input: {
  actor: TestUser;
  reader: TestUser;
  root: StoredRootFixture;
}): Promise<string> {
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
        accessLevel: "read",
        containerId: input.root.kekState.containerId,
      },
    ],
  });
  const grantMutation = await submitSuccessor({
    actor: input.actor,
    containerMutation: await buildReadGroupGrantMutation({
      actor: input.actor,
      policy: granted.policy,
      root: input.root,
    }),
    groupId,
    organizationId,
    successor: granted,
  });
  const grantedRoot: StoredRootFixture = {
    bundle: accessManifestFromContainerResponse(grantMutation),
    kekState: kekStateFromContainerResponse(grantMutation),
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
  const rekey = await buildRootContainerRekeyMutation({
    previous: grantedRoot,
    replacementPrincipalPolicy: rotated.policy,
    signer: input.actor,
  });
  await submitSuccessor({
    actor: input.actor,
    containerMutation: rekey.request,
    groupId,
    organizationId,
    successor: rotated,
  });
  return groupId;
}
