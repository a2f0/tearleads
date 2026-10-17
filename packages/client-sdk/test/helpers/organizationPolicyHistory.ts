import {
  generateKemSeedAndKeyPair,
  generateSigningSeedAndKeyPair,
  toFingerprint,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type {
  PrincipalPolicyBundleResponse,
  PrincipalPolicySnapshotResponse,
} from "@tearleads/validators/response";
import { parseOrganizationAuthorityDescriptor } from "../../src/data/principals/organizationAuthorityDescriptor";
import {
  buildOrganizationGroupDirectoryPolicyRequest,
  replaceOrganizationGroupHead,
} from "../../src/workflows/organizations/organizationGroupDirectory";
import { buildInitialOrganizationPolicyRequest } from "../../src/workflows/registration/registerIdentity";
import {
  buildInitialGroupPolicyRequest,
  testGroupMetadataKey,
} from "./groupMetadata";
import {
  organizationPolicyBundleFromInitialRequest,
  policyBundleAfterMutation,
  policyBundleFromInitialRequest,
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
} from "./projectionPolicyHistory";
import { createTestTrustedUserIdentity } from "./trustedUserIdentity";

export function policySnapshot(
  bundle: PrincipalPolicyBundleResponse,
): PrincipalPolicySnapshotResponse {
  return {
    currentState: bundle.currentState,
    currentProjection: bundle.currentProjection,
    currentGrants: bundle.currentGrants,
    previousStates: bundle.previousStates,
  };
}

/** The organization creator who signs every policy in one history. */
interface OrganizationHistorySigner {
  readonly creatorEncapsulationKeyPair: ReturnType<
    typeof generateKemSeedAndKeyPair
  >;
  readonly organizationId: string;
  readonly signerUserId: string;
  readonly signingFingerprint: string;
  readonly signingKeyPair: ReturnType<typeof generateSigningSeedAndKeyPair>;
}

function signingFields(signer: OrganizationHistorySigner) {
  return {
    signerUserId: signer.signerUserId,
    signingFingerprint: signer.signingFingerprint,
    signingKeyPair: signer.signingKeyPair,
  };
}

// Built from the signer rather than stored: its brand is a symbol property,
// which a structured copy of the history would drop.
function signerIdentityOf(signer: OrganizationHistorySigner) {
  return createTestTrustedUserIdentity({
    userId: signer.signerUserId,
    signingPublicKey: signer.signingKeyPair.signingPublicKey,
    signingKeyFingerprint: signer.signingFingerprint,
    encapsulationPublicKey: signer.creatorEncapsulationKeyPair.publicKey,
  });
}

/** A new group; `authority` names an external admin group, null the signer. */
async function signGroupPolicy(
  signer: OrganizationHistorySigner,
  name: string,
  authority: PrincipalPolicyBundleResponse | null,
): Promise<PrincipalPolicyBundleResponse> {
  return policyBundleFromInitialRequest(
    await buildInitialGroupPolicyRequest({
      ...signingFields(signer),
      creatorEncapsulationKeyPair: signer.creatorEncapsulationKeyPair,
      groupId: crypto.randomUUID(),
      name,
      metadataKey: testGroupMetadataKey(signer.organizationId),
      includeSignerAsAdmin: authority === null,
      ...(authority === null
        ? {}
        : {
            externalAuthority: principalPolicyHead(authority) as {
              principalType: "group";
            } & ReturnType<typeof principalPolicyHead>,
          }),
    }),
  );
}

/** The next directory version: `next` replaces its head, null drops `created`. */
async function advanceDirectoryPolicy(input: {
  readonly admin: PrincipalPolicyBundleResponse;
  readonly created: PrincipalPolicyBundleResponse;
  readonly next: PrincipalPolicyBundleResponse | null;
  readonly previous: PrincipalPolicyBundleResponse;
  readonly signer: OrganizationHistorySigner;
}): Promise<PrincipalPolicyBundleResponse> {
  const descriptor = parseOrganizationAuthorityDescriptor(
    input.previous.currentPayload.ciphertext,
  );
  return policyBundleAfterMutation({
    previous: input.previous,
    mutation: await buildOrganizationGroupDirectoryPolicyRequest({
      ...signingFields(input.signer),
      adminProjection: input.admin.currentProjection,
      adminUsers: [signerIdentityOf(input.signer)],
      currentPolicy: input.previous,
      descriptor,
      groupHeads: input.next
        ? replaceOrganizationGroupHead({
            descriptor,
            nextHead: principalPolicyHead(input.next),
          })
        : descriptor.groupHeads.filter(
            (head) =>
              head.principalId !== input.created.currentState.principalId,
          ),
    }),
  });
}

/**
 * Signs one organization: its Admins and Members groups, a group created under
 * Admins authority, and the directory history that adds, extends, and deletes
 * that group. The result is plain data, safe to copy with structuredClone.
 */
export async function signOrganizationHistory() {
  const signingKeyPair = generateSigningSeedAndKeyPair();
  const signer: OrganizationHistorySigner = {
    creatorEncapsulationKeyPair: generateKemSeedAndKeyPair(),
    organizationId: crypto.randomUUID(),
    signerUserId: crypto.randomUUID(),
    signingFingerprint: await toFingerprint(signingKeyPair.signingPublicKey),
    signingKeyPair,
  };
  const targetUserId = crypto.randomUUID();
  const admin = await signGroupPolicy(signer, "Admins", null);
  const members = await signGroupPolicy(signer, "Members", null);
  const created = await signGroupPolicy(signer, "Private support name", admin);
  const initial = await organizationPolicyBundleFromInitialRequest(
    signer.organizationId,
    await buildInitialOrganizationPolicyRequest({
      adminGroupId: admin.currentState.principalId,
      memberGroupId: members.currentState.principalId,
      groupHeads: [principalPolicyHead(admin), principalPolicyHead(members)],
      organizationId: signer.organizationId,
      signingKeyPair,
      userId: signer.signerUserId,
      encapsulationPublicKey: signer.creatorEncapsulationKeyPair.publicKey,
    }),
  );
  const advance = (
    previous: PrincipalPolicyBundleResponse,
    next: PrincipalPolicyBundleResponse | null,
  ) => advanceDirectoryPolicy({ admin, created, next, previous, signer });
  const afterCreation = await advance(initial, created);
  const added = await signedPrincipalPolicyBundle({
    memberEnvelopes: [],
    payloadCiphertext: created.currentPayload.ciphertext,
    projection: [{ userId: targetUserId, role: "member" }],
    previousStates: [
      {
        state: created.currentState,
        projection: created.currentProjection,
        grants: created.currentGrants,
      },
    ],
    signing: {
      ...created.currentState,
      version: 2,
      prevStateHash: created.currentState.stateHash,
      signedAt: new Date().toISOString(),
    },
    signingPrivateKey: signingKeyPair.signingPrivateKey,
  });
  const afterAddition = await advance(afterCreation, added);
  const afterDeletion = await advance(afterAddition, null);
  return {
    added,
    admin,
    afterAddition,
    afterCreation,
    afterDeletion,
    created,
    initial,
    members,
    signer,
    targetUserId,
  };
}

export type OrganizationHistory = Awaited<
  ReturnType<typeof signOrganizationHistory>
>;

/**
 * The fixture operations bound to one signed history. Each operation closes
 * over the history it is given, so binding a copy yields a fixture that never
 * touches the original's objects.
 */
export function organizationHistoryFixtureFrom(history: OrganizationHistory) {
  const {
    added,
    admin,
    afterAddition,
    afterCreation,
    afterDeletion,
    created,
    initial,
    members,
    signer,
  } = history;
  const { signingKeyPair } = signer;
  const signerIdentity = signerIdentityOf(signer);
  const createGroup = (
    name: string,
    includeSignerAsAdmin = true,
    authority?: PrincipalPolicyBundleResponse,
  ) =>
    signGroupPolicy(
      signer,
      name,
      includeSignerAsAdmin ? null : (authority ?? admin),
    );
  const advanceDirectory = (
    previous: PrincipalPolicyBundleResponse,
    next: PrincipalPolicyBundleResponse | null,
  ) => advanceDirectoryPolicy({ admin, created, next, previous, signer });
  const resolveTrustedUserIdentity = async (userId: string) =>
    userId === signer.signerUserId ? signerIdentity : null;
  const projectionBundles = [
    initial,
    afterCreation,
    afterAddition,
    afterDeletion,
    admin,
    members,
    created,
    added,
  ];
  const projectionEvidence = (deleted = false) => ({
    organization: projectionPolicySource(
      deleted ? afterDeletion : afterAddition,
    ),
    organizationPayloads: [
      initial,
      afterCreation,
      afterAddition,
      ...(deleted ? [afterDeletion] : []),
    ].map(projectionDirectoryPayload),
    groups: [admin, members, added].map(projectionPolicySource),
  });
  const evidence = (deleted = false) => ({
    organizationId: signer.organizationId,
    stateHash: (deleted ? afterDeletion : afterAddition).currentState.stateHash,
    beforeVersion:
      (deleted ? afterDeletion : afterAddition).currentState.version + 1,
    nextBeforeVersion: null,
    evidence: projectionEvidence(deleted),
  });
  const advanceGroup = async (
    previous: PrincipalPolicyBundleResponse,
    projection: PrincipalPolicyBundleResponse["currentProjection"],
    grants: PrincipalPolicyBundleResponse["currentGrants"],
    rotate = false,
  ) => {
    const key = rotate ? generateKemSeedAndKeyPair() : null;
    return signedPrincipalPolicyBundle({
      memberEnvelopes: [],
      payloadCiphertext: previous.currentPayload.ciphertext,
      projection,
      previousStates: [
        ...previous.previousStates,
        {
          state: previous.currentState,
          projection: previous.currentProjection,
          grants: previous.currentGrants,
        },
      ],
      signing: {
        ...previous.currentState,
        version: previous.currentState.version + 1,
        prevStateHash: previous.currentState.stateHash,
        signedAt: new Date().toISOString(),
        grants,
        ...(key
          ? {
              keyEpoch: previous.currentState.keyEpoch + 1,
              encapsulationPublicKey: bytesToBase64(key.publicKey),
              keyFingerprint: await toFingerprint(key.publicKey),
            }
          : {}),
      },
      signingPrivateKey: signingKeyPair.signingPrivateKey,
    });
  };
  return {
    admin,
    memberPolicy: members,
    creatorEncapsulationKeyPair: signer.creatorEncapsulationKeyPair,
    signingKeyPair,
    advanceGroup,
    advanceDirectory,
    createGroup,
    organizationId: signer.organizationId,
    signerUserId: signer.signerUserId,
    targetUserId: history.targetUserId,
    created,
    added,
    initial,
    afterCreation,
    afterAddition,
    afterDeletion,
    evidence,
    projectionBundles,
    projectionEvidence,
    resolveTrustedUserIdentity,
  };
}

export async function createOrganizationHistoryFixture() {
  return organizationHistoryFixtureFrom(await signOrganizationHistory());
}
