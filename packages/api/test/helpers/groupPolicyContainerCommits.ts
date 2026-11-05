import { expect } from "bun:test";
import { db } from "@tearleads/api-shared/postgres";
import type {
  ContainerGrantPrincipalHead,
  PrincipalContainerGrant,
  PrincipalProjectionMember,
  PrincipalStateMember,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  makeVerifiedPrincipalPolicy,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { TestUser } from "@tearleads/test-utils";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import invariant from "invariant";
import { routeApp } from "../../src/routeApp";
import { groupPolicyPayload } from "./groupPolicyPayload";
import { getDefaultOrganizationId } from "./organizationMembership";
import { createPrincipalMemberEnvelopes } from "./principalMemberEnvelopes";
import {
  loadVerifiedPrincipalPolicy,
  submitOrganizationGroupPolicyCommit,
  withOrganizationGroupDirectoryPolicy,
} from "./principalPolicy";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "./principalState";
import {
  type StoredContainerMutation,
  withStoredContainerMutation,
} from "./storedContainerMutation";

export async function putGroupPrincipalPolicy(input: {
  readonly actor: TestUser;
  readonly containerMutations?: readonly ContainerMutationRequest[];
  readonly grants?: readonly PrincipalContainerGrant[];
  readonly keyEpoch?: number;
  readonly members?: readonly PrincipalStateMember[];
  readonly prevStateHash?: string | null;
  readonly principalId: string;
  readonly principalKem?: ReturnType<typeof generateKemSeedAndKeyPair>;
  readonly prepareContainerMutations?: (input: {
    readonly policy: VerifiedPrincipalPolicy;
    readonly reference: ContainerGrantPrincipalHead;
  }) => Promise<readonly ContainerMutationRequest[]>;
  readonly projection?: readonly PrincipalProjectionMember[];
  readonly signedAt?: string;
  readonly version?: number;
}): Promise<{
  readonly containerMutations: readonly ContainerMutationResponse[];
  readonly policy: VerifiedPrincipalPolicy;
  readonly reference: ContainerGrantPrincipalHead;
  readonly stateHash: string;
}> {
  const principalKem = input.principalKem ?? generateKemSeedAndKeyPair();
  const members = [...(input.members ?? [{ userId: input.actor.userId }])];
  const projection = [
    ...(input.projection ??
      createProjectionWithAdminSigner(input.actor.userId, members)),
  ];
  const isInitialState =
    (input.version ?? 1) === 1 && (input.prevStateHash ?? null) === null;
  const currentPolicy = isInitialState
    ? null
    : await loadVerifiedPrincipalPolicy(db, "group", input.principalId);
  const policyGrants = input.grants ?? currentPolicy?.grants ?? [];
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });
  const signedState = await signPrincipalStateBundle({
    principalType: "group",
    principalId: input.principalId,
    version: input.version ?? 1,
    prevStateHash: input.prevStateHash ?? null,
    keyEpoch: input.keyEpoch ?? 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    grants: [...policyGrants],
    payloadCiphertext: await groupPolicyPayload(
      input.principalId,
      projection,
      undefined,
      await getDefaultOrganizationId(input.actor.userId),
    ),
    signedAt:
      input.signedAt ?? new Date("2026-04-30T00:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
    memberEnvelopes,
  });
  const stateHash = await computePrincipalStateHash(signedState.state);
  let preparedContainerMutations = input.containerMutations;
  if (input.prepareContainerMutations) {
    invariant(!isInitialState, "initial groups have no successor history");
    invariant(
      !input.containerMutations,
      "provide either container mutations or a mutation preparer",
    );
    invariant(currentPolicy, "expected current group policy");
    const nextState = {
      ...signedState.state,
      stateHash,
      createdAt: signedState.state.signedAt,
    };
    const nextPolicy = makeVerifiedPrincipalPolicy({
      principalType: nextState.principalType,
      principalId: nextState.principalId,
      version: nextState.version,
      keyEpoch: nextState.keyEpoch,
      stateHash,
      state: nextState,
      projection: signedState.projection,
      grants: signedState.grants,
      history: [
        {
          state: currentPolicy.state,
          projection: currentPolicy.projection,
          grants: currentPolicy.grants,
        },
        {
          state: nextState,
          projection: signedState.projection,
          grants: signedState.grants,
        },
      ],
      checkpoint: {
        principalType: nextState.principalType,
        principalId: nextState.principalId,
        version: nextState.version,
        stateHash,
      },
    });
    preparedContainerMutations = await input.prepareContainerMutations({
      policy: nextPolicy,
      reference: {
        principalType: "group",
        principalId: nextPolicy.principalId,
        version: nextPolicy.version,
        keyEpoch: nextPolicy.keyEpoch,
        stateHash: nextPolicy.stateHash,
        keyFingerprint: nextPolicy.state.keyFingerprint,
      },
    });
  }
  const policyRequest = {
    state: signedState.state,
    encryptedPayload: signedState.encryptedPayload,
    projection: signedState.projection,
    grants: signedState.grants,
    memberEnvelopes: signedState.memberEnvelopes,
    ...(preparedContainerMutations
      ? { containerMutations: [...preparedContainerMutations] }
      : {}),
  };
  let response: Response;
  if (isInitialState) {
    const organizationId = await getDefaultOrganizationId(input.actor.userId);
    response = await routeApp.request(
      `/organizations/${organizationId}/groups`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${input.actor.token}`,
        },
        body: JSON.stringify({
          ...(await withOrganizationGroupDirectoryPolicy({
            actor: input.actor,
            organizationId,
            request: {
              groupId: input.principalId,
              initialGroupPolicy: policyRequest,
            },
          })),
        }),
      },
    );
  } else {
    response = await submitOrganizationGroupPolicyCommit({
      actor: input.actor,
      groupId: input.principalId,
      groupPolicy: policyRequest,
      organizationId: await getDefaultOrganizationId(input.actor.userId),
    });
  }

  expect(response.status, await response.clone().text()).toBe(200);
  const responseBody = isInitialState
    ? null
    : (
        (await response.json()) as {
          groupPolicy: PrincipalPolicyMutationResponse;
        }
      ).groupPolicy;
  const policy = await loadVerifiedPrincipalPolicy(
    db,
    "group",
    input.principalId,
  );
  expect(policy.stateHash).toBe(stateHash);
  const reference: ContainerGrantPrincipalHead = {
    principalType: "group",
    principalId: input.principalId,
    version: policy.version,
    keyEpoch: policy.keyEpoch,
    stateHash,
    keyFingerprint: policy.state.keyFingerprint,
  };

  return {
    containerMutations: responseBody?.containerMutations ?? [],
    policy,
    reference,
    stateHash,
  };
}

export async function commitGroupGrant(input: {
  readonly accessLevel?: "admin" | "read" | "write";
  readonly actor: TestUser;
  readonly buildMutation: (input: {
    readonly policy: VerifiedPrincipalPolicy;
    readonly reference: ContainerGrantPrincipalHead;
  }) => Promise<ContainerMutationRequest>;
  readonly containerId: string;
  readonly current: Awaited<ReturnType<typeof putGroupPrincipalPolicy>>;
  readonly signedAt?: string;
}) {
  const nextGrants = [
    ...input.current.policy.grants.filter(
      (grant) => grant.containerId !== input.containerId,
    ),
    {
      accessLevel: input.accessLevel ?? ("read" as const),
      containerId: input.containerId,
    },
  ];
  return putGroupPrincipalPolicy({
    actor: input.actor,
    grants: nextGrants,
    keyEpoch: input.current.policy.keyEpoch + 1,
    members: input.current.policy.projection.map((member) => ({
      userId: member.userId,
    })),
    prevStateHash: input.current.stateHash,
    principalId: input.current.policy.principalId,
    projection: [...input.current.policy.projection],
    prepareContainerMutations: async (next) => [
      await input.buildMutation(next),
    ],
    ...(input.signedAt ? { signedAt: input.signedAt } : {}),
    version: input.current.policy.version + 1,
  });
}

export async function firstCompoundMutation(
  result: Awaited<ReturnType<typeof putGroupPrincipalPolicy>>,
): Promise<StoredContainerMutation> {
  const mutation = result.containerMutations[0];
  invariant(mutation, "expected compound principal container mutation");
  return withStoredContainerMutation(mutation);
}
