import { type ApiDatabase, db } from "@tearleads/api-shared/postgres";
import { groups, organizations, users } from "@tearleads/api-shared/schema";
import {
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  type ManagedPrincipalKind,
  type PrincipalContainerGrant,
  toFingerprint,
  type VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  CommitOrganizationGroupPolicyRequest,
  CreateOrganizationGroupRequest,
  DeleteOrganizationGroupRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { eq } from "drizzle-orm";
import invariant from "invariant";
import { getCurrentPrincipalState } from "../../src/access/read/principalStateStore";
import { routeApp } from "../../src/routeApp";
import { parseOrganizationAuthorityDescriptor } from "../../src/workflows/organizations/organizationAuthorityDescriptor";
import { runGetCurrentPrincipalPolicyWorkflow } from "../../src/workflows/principals/getCurrentPrincipalPolicy";
import { createPrincipalMemberEnvelopes } from "./principalMemberEnvelopes";
import {
  createProjectionWithAdminSigner,
  signPrincipalStateBundle,
} from "./principalState";

function verifiedPrincipalPolicyFromBundle(
  bundle: PrincipalPolicyBundleResponse,
): VerifiedPrincipalPolicy {
  const state = bundle.currentState;
  return {
    principalType: state.principalType,
    principalId: state.principalId,
    version: state.version,
    keyEpoch: state.keyEpoch,
    stateHash: state.stateHash,
    state,
    projection: bundle.currentProjection,
    grants: bundle.currentGrants,
    history: [
      ...bundle.previousStates,
      {
        state,
        projection: bundle.currentProjection,
        grants: bundle.currentGrants,
      },
    ],
    checkpoint: {
      principalType: state.principalType,
      principalId: state.principalId,
      version: state.version,
      stateHash: state.stateHash,
    },
  } as unknown as VerifiedPrincipalPolicy;
}

export async function loadVerifiedPrincipalPolicy(
  database: ApiDatabase,
  principalType: ManagedPrincipalKind,
  principalId: string,
): Promise<VerifiedPrincipalPolicy> {
  return verifiedPrincipalPolicyFromBundle(
    await runGetCurrentPrincipalPolicyWorkflow(
      database,
      principalType,
      principalId,
    ),
  );
}

export async function createSignedPrincipalState(input: {
  externalAuthority?: Parameters<
    typeof signPrincipalStateBundle
  >[0]["externalAuthority"];
  keyEpoch?: number;
  grants?: readonly PrincipalContainerGrant[];
  members: Array<{ userId: string }>;
  prevStateHash?: string | null;
  principalKem?: ReturnType<typeof generateKemSeedAndKeyPair>;
  principalId: string;
  principalType: "group" | "organization";
  signedAt?: string;
  signerUserId: string;
  signerUserKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  version?: number;
  projection?: Array<{
    userId: string;
    role: "member" | "admin";
  }>;
}) {
  const principalKem = input.principalKem ?? generateKemSeedAndKeyPair();
  const projection =
    input.projection ??
    createProjectionWithAdminSigner(input.signerUserId, input.members);
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: principalKem.secretKey,
      projection,
    });

  return signPrincipalStateBundle({
    principalType: input.principalType,
    principalId: input.principalId,
    version: input.version ?? 1,
    prevStateHash: input.prevStateHash ?? null,
    keyEpoch: input.keyEpoch ?? 1,
    encapsulationPublicKey: bytesToBase64(principalKem.publicKey),
    keyFingerprint: await toFingerprint(principalKem.publicKey),
    members: stateMembers,
    projection,
    grants: [...(input.grants ?? [])],
    externalAuthority: input.externalAuthority ?? null,
    payloadCiphertext:
      input.principalType === "group"
        ? await groupPolicyPayload(input.principalId, input.members)
        : bytesToBase64(
            new TextEncoder().encode(JSON.stringify(input.members)),
          ),
    signedAt:
      input.signedAt ?? new Date("2026-04-08T16:00:00.000Z").toISOString(),
    signerUserId: input.signerUserId,
    signerUserKeyFingerprint: input.signerUserKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
    memberEnvelopes,
  });
}

export async function getDefaultOrganizationId(
  userId: string,
): Promise<string> {
  const [user] = await db
    .select({ organizationId: users.defaultOrganizationId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  invariant(user, "expected registered user");
  return user.organizationId;
}

export async function createPolicyTestGroup(
  ownerUserId: string,
  groupId: string,
): Promise<void> {
  await db.insert(groups).values({
    id: groupId,
    name: `Policy test ${groupId}`,
    organizationId: await getDefaultOrganizationId(ownerUserId),
  });
}

async function buildOrganizationPolicyForGroupCommit(input: {
  actor: {
    fingerprint: string;
    signing: { signingPrivateKey: Uint8Array };
    userId: string;
  };
  groupPolicy?: PutPrincipalPolicyRequest | undefined;
  organizationId: string;
  removedGroupId?: string | undefined;
}) {
  if (
    (input.groupPolicy === undefined) ===
    (input.removedGroupId === undefined)
  ) {
    throw new Error("Exactly one group directory mutation is required");
  }
  const [organization] = await db
    .select({
      adminGroupId: organizations.adminGroupId,
      memberGroupId: organizations.memberGroupId,
    })
    .from(organizations)
    .where(eq(organizations.id, input.organizationId))
    .limit(1);
  invariant(organization, "expected organization");
  const organizationState = await getCurrentPrincipalState(
    "organization",
    input.organizationId,
    db,
  );
  invariant(organizationState, "expected organization policy");
  const organizationBundle = await runGetCurrentPrincipalPolicyWorkflow(
    db,
    "organization",
    input.organizationId,
  );
  const organizationProjection =
    input.groupPolicy?.state.principalId === organization.adminGroupId
      ? input.groupPolicy.projection
      : organizationBundle.currentProjection;
  const descriptor = parseOrganizationAuthorityDescriptor(
    organizationBundle.currentPayload.ciphertext,
  );
  invariant(descriptor, "expected organization authority descriptor");
  const groupHeads = input.groupPolicy
    ? [
        ...descriptor.groupHeads.filter(
          (head) => head.principalId !== input.groupPolicy?.state.principalId,
        ),
        {
          principalType: "group" as const,
          principalId: input.groupPolicy.state.principalId,
          version: input.groupPolicy.state.version,
          keyEpoch: input.groupPolicy.state.keyEpoch,
          stateHash: await computePrincipalStateHash(input.groupPolicy.state),
          keyFingerprint: input.groupPolicy.state.keyFingerprint,
        },
      ]
    : descriptor.groupHeads.filter(
        (head) => head.principalId !== input.removedGroupId,
      );
  groupHeads.sort((left, right) =>
    left.principalId.localeCompare(right.principalId),
  );
  const organizationKem = generateKemSeedAndKeyPair();
  const { memberEnvelopes, stateMembers } =
    await createPrincipalMemberEnvelopes({
      principalSecretKey: organizationKem.secretKey,
      projection: organizationProjection,
    });
  return signPrincipalStateBundle({
    principalType: "organization",
    principalId: input.organizationId,
    version: organizationState.version + 1,
    prevStateHash: organizationState.stateHash,
    keyEpoch: organizationState.keyEpoch + 1,
    encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
    keyFingerprint: await toFingerprint(organizationKem.publicKey),
    members: stateMembers,
    projection: organizationProjection,
    grants: [],
    memberEnvelopes,
    payloadCiphertext: bytesToBase64(
      new TextEncoder().encode(
        JSON.stringify({
          version: 2,
          organizationId: input.organizationId,
          adminGroupId: organization.adminGroupId,
          memberGroupId: organization.memberGroupId,
          groupHeads,
        }),
      ),
    ),
    externalAuthority: null,
    signedAt: new Date("2026-08-11T12:00:00.000Z").toISOString(),
    signerUserId: input.actor.userId,
    signerUserKeyFingerprint: input.actor.fingerprint,
    signingPrivateKey: input.actor.signing.signingPrivateKey,
  });
}

export async function buildOrganizationGroupDeletionRequest(input: {
  actor: Parameters<typeof buildOrganizationPolicyForGroupCommit>[0]["actor"];
  groupId: string;
  organizationId: string;
}): Promise<DeleteOrganizationGroupRequest> {
  return {
    organizationPolicy: await buildOrganizationPolicyForGroupCommit({
      actor: input.actor,
      organizationId: input.organizationId,
      removedGroupId: input.groupId,
    }),
  };
}

export async function withOrganizationGroupDirectoryPolicy(input: {
  actor: Parameters<typeof buildOrganizationPolicyForGroupCommit>[0]["actor"];
  organizationId: string;
  request: CreateOrganizationGroupRequest;
}) {
  return {
    ...input.request,
    organizationPolicy: await buildOrganizationPolicyForGroupCommit({
      actor: input.actor,
      groupPolicy: input.request.initialGroupPolicy,
      organizationId: input.organizationId,
    }),
  };
}

async function buildOrganizationGroupPolicyCommitRequest(input: {
  actor: Parameters<typeof buildOrganizationPolicyForGroupCommit>[0]["actor"];
  groupPolicy: PutPrincipalPolicyRequest;
  organizationId: string;
}): Promise<CommitOrganizationGroupPolicyRequest> {
  return {
    groupPolicy: input.groupPolicy,
    organizationPolicy: await buildOrganizationPolicyForGroupCommit(input),
  };
}

export async function submitOrganizationGroupPolicyCommit(input: {
  actor: Parameters<
    typeof buildOrganizationPolicyForGroupCommit
  >[0]["actor"] & {
    token: string;
  };
  groupId: string;
  groupPolicy: PutPrincipalPolicyRequest;
  organizationId: string;
  request?: (path: string, init: RequestInit) => Response | Promise<Response>;
}): Promise<Response> {
  const request =
    input.request ??
    ((path: string, init: RequestInit) => routeApp.request(path, init));
  return request(
    `/organizations/${input.organizationId}/groups/${input.groupId}/policy-commit`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.actor.token}`,
      },
      body: JSON.stringify(
        await buildOrganizationGroupPolicyCommitRequest(input),
      ),
    },
  );
}

import { groupPolicyPayload } from "./groupPolicyPayload";
