import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  containerMetadataDocuments,
  groups,
  organizationReadModelHeads,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  normalizePrincipalContainerGrants,
  type PrincipalPolicyAuthorization,
} from "@tearleads/crypto";
import {
  documentCreateSeedSyncRequest,
  type OrganizationProvisioningRequest,
  type PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  DocumentCreateResponse,
} from "@tearleads/validators/response";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { createDocumentWithExecutor } from "../documents/mutations";
import { appendProvisionedDocumentInitialUpdate } from "../documents/mutations/syncDocument";
import { listCurrentPrincipalContainerGrants } from "../principals/principalContainerGrants";
import { lockPrincipalMutationInTransaction } from "../principals/principalMutationLock";
import { storeVerifiedPrincipalPolicyInTransaction } from "../principals/storeVerifiedPrincipalPolicy";
import { wasOrganizationGroupDeleted } from "./groupTombstone";
import {
  createInitialOrganizationBillingRow,
  type InitialOrganizationBilling,
} from "./initialBilling";
import {
  storeInitialMemberGroupPolicy,
  syncInitialRosterAndBillingSeats,
} from "./initialMemberGroupBilling";
import { OrganizationProvisioningError } from "./provisionOrganizationError";
import {
  createInitialOrganizationProfileDocument,
  createInitialRosterProfileDocument,
  readDocumentCreateRequestId,
} from "./provisionOrganizationProfiles";
import { storeInitialRootContainer } from "./provisionOrganizationRootContainer";
import { createRootContainer } from "./provisionOrganizationRootRow";
import {
  createInitialOrganizationMetadataContainer,
  createInitialRosterProfileContainer,
  createProvisionedSystemContainers,
  createProvisioningVerifiedContext,
  type ProvisioningVerifiedContext,
} from "./provisionOrganizationSystemContainers";

/**
 * Identity material for the founding admin whose signatures the provisioning
 * artifacts were produced with. For registration this is the newly-created
 * user; for an additional organization it is the authenticated caller, resolved
 * from the stored `users` row.
 */
export interface OrganizationProvisioningSigner {
  readonly fingerprint: string;
  readonly encapsulationFingerprint: string;
  readonly signingPublicKey: Uint8Array;
}

async function lockProvisioningGroupPrincipalIds(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
): Promise<void> {
  const groupIds = [
    input.initialAdminGroup.groupId,
    input.initialMemberGroup.groupId,
  ].toSorted();
  for (const groupId of groupIds) {
    await lockPrincipalMutationInTransaction(tx, "group", groupId);
    const [wasDeleted, currentState] = await Promise.all([
      wasOrganizationGroupDeleted({ executor: tx, groupId }),
      getCurrentPrincipalState("group", groupId, tx),
    ]);
    if (wasDeleted || currentState) {
      throw new OrganizationProvisioningError(
        "Provisioning group principal ID is unavailable",
        409,
      );
    }
  }
}

async function lockProvisioningOrganizationPrincipalId(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
): Promise<void> {
  await lockPrincipalMutationInTransaction(
    tx,
    "organization",
    input.organizationId,
  );
  if (
    await getCurrentPrincipalState("organization", input.organizationId, tx)
  ) {
    throw new OrganizationProvisioningError(
      "Provisioning organization principal ID is unavailable",
      409,
    );
  }
}

async function createOrganizationRow(
  tx: DatabaseTransaction,
  input: {
    adminGroupId: string;
    memberGroupId: string;
    organizationId: string;
    rootContainerId: string;
  },
) {
  const [org] = await tx
    .insert(organizations)
    .values({
      adminGroupId: input.adminGroupId,
      id: input.organizationId,
      memberGroupId: input.memberGroupId,
      rootContainerId: input.rootContainerId,
    })
    .returning({ id: organizations.id });
  if (!org) {
    throw new Error("Failed to create organization");
  }
  await tx
    .insert(organizationReadModelHeads)
    .values({ organizationId: org.id });
  return org;
}

async function createInitialGroup(
  tx: DatabaseTransaction,
  input: { groupId: string; organizationId: string },
): Promise<void> {
  const [group] = await tx
    .insert(groups)
    .values({
      id: input.groupId,
      organizationId: input.organizationId,
    })
    .returning({ id: groups.id });

  if (!group) {
    throw new OrganizationProvisioningError("Failed to create group", 500);
  }
}

async function storeInitialPolicy(
  tx: DatabaseTransaction,
  bundle: PutPrincipalPolicyRequest,
  identityTrustDomain: string,
  reservedAdmins = false,
): Promise<PrincipalPolicyAuthorization> {
  let verifiedPolicy: PrincipalPolicyAuthorization | undefined;
  await storeVerifiedPrincipalPolicyInTransaction(
    {
      state: bundle.state,
      encryptedPayload: bundle.encryptedPayload,
      projection: bundle.projection,
      grants: bundle.grants,
      memberEnvelopes: bundle.memberEnvelopes,
    },
    tx,
    {
      identityTrustDomain,
      onVerified: (policy) => {
        verifiedPolicy = policy;
      },
      reservedAdmins,
    },
  );
  if (!verifiedPolicy) {
    throw new Error("Expected verified principal policy after storage");
  }
  return verifiedPolicy;
}

async function assertProvisionedGroupGrantIndex(
  tx: DatabaseTransaction,
  policy: PutPrincipalPolicyRequest,
): Promise<void> {
  const expected = normalizePrincipalContainerGrants(policy.grants);
  const actual = await listCurrentPrincipalContainerGrants({
    executor: tx,
    principalId: policy.state.principalId,
  });
  if (
    actual.length !== expected.length ||
    actual.some((grant, index) => {
      const entry = expected[index];
      return (
        !entry ||
        entry.containerId !== grant.containerId ||
        entry.accessLevel !== grant.accessLevel
      );
    })
  ) {
    throw new OrganizationProvisioningError(
      "Provisioned group grants do not match the signed principal grant index",
      409,
    );
  }
}

async function createInitialRootMetadataDocument(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
  rootMetadata: {
    metadataDocumentId: string;
  },
  provisioningContext: ProvisioningVerifiedContext,
): Promise<DocumentCreateResponse> {
  const requestDocumentId = readDocumentCreateRequestId(
    input.initialRootMetadataDocument,
  );
  if (requestDocumentId !== rootMetadata.metadataDocumentId) {
    throw new OrganizationProvisioningError(
      "Initial root metadata document does not match root container metadata",
      400,
    );
  }

  const { created, lockedContainerHeads, createdDocumentSeed } =
    await createDocumentWithExecutor({
      containerTouch: "seed",
      executor: tx,
      fingerprint: signer.fingerprint,
      request: input.initialRootMetadataDocument,
      userId: input.userId,
      verifiedContainerContext: provisioningContext.verifiedContainerContext,
      verifiedPrincipalPolicies: provisioningContext.verifiedPrincipalPolicies,
    });
  if (created.id !== rootMetadata.metadataDocumentId) {
    throw new OrganizationProvisioningError(
      "Initial root metadata response does not match root container metadata",
      400,
    );
  }

  await tx.insert(containerMetadataDocuments).values({
    containerId: input.rootContainerId,
    documentId: created.id,
  });
  await appendProvisionedDocumentInitialUpdate({
    documentId: created.id,
    executor: tx,
    fingerprint: signer.fingerprint,
    lockedContainerHeads,
    createdDocumentSeed,
    request: documentCreateSeedSyncRequest(
      input.initialRootMetadataDocument,
      input.initialRootMetadataDocument.initialSync,
    ),
    signingPublicKey: signer.signingPublicKey,
    userId: input.userId,
  });

  return created;
}

function listCommittedProfileUpdateIds(
  input: OrganizationProvisioningRequest,
): string[] {
  return [
    input.initialRosterProfileDocument,
    input.initialOrganizationProfileDocument,
  ].flatMap((request) =>
    request
      ? request.initialSync.outgoingUpdates.map((update) => update.id)
      : [],
  );
}

function listCommittedCoreMetadataUpdateIds(
  input: OrganizationProvisioningRequest,
): string[] {
  return [
    input.initialRootMetadataDocument.initialSync,
    input.initialRosterProfileContainer?.initialMetadataSync,
    input.initialOrganizationMetadataContainer.initialMetadataSync,
  ].flatMap((initialSync) =>
    initialSync ? initialSync.outgoingUpdates.map((update) => update.id) : [],
  );
}

export interface ProvisionOrganizationOptions {
  readonly identityTrustDomain: string;
  readonly initialBilling: InitialOrganizationBilling;
  /**
   * Invoked after creating the org row and root container, before groups and
   * policies (used by registration to insert the founding user).
   */
  readonly onOrganizationRootCreated?:
    | ((organizationId: string) => Promise<void>)
    | undefined;
}

export interface ProvisionedOrganization {
  organizationId: string;
  rootBundleDigest: string;
  rootContainerId: string;
  rootMetadataAccessEpoch: number;
  rootMetadataAccessStateHash: string;
  rootMetadataDocumentId: string;
  rootMetadataDocument: DocumentCreateResponse;
  rosterProfileContainer: ContainerCreateWithMetadataDocumentResponse | null;
  rosterProfileDocument: DocumentCreateResponse | null;
  organizationMetadataContainer: ContainerCreateWithMetadataDocumentResponse;
  organizationProfileDocument: DocumentCreateResponse | null;
  systemContainers: ContainerCreateWithMetadataDocumentResponse[];
  committedCoreMetadataUpdateIds: string[];
  committedProfileUpdateIds: string[];
}

async function provisionOrganizationAuthorityAndBilling(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  options: ProvisionOrganizationOptions,
): Promise<{
  organizationId: string;
  rootContainerId: string;
  verifiedPrincipalPolicies: readonly PrincipalPolicyAuthorization[];
}> {
  await lockProvisioningOrganizationPrincipalId(tx, input);
  await lockProvisioningGroupPrincipalIds(tx, input);
  const org = await createOrganizationRow(tx, {
    adminGroupId: input.initialAdminGroup.groupId,
    memberGroupId: input.initialMemberGroup.groupId,
    organizationId: input.organizationId,
    rootContainerId: input.rootContainerId,
  });
  const initialBilling = await createInitialOrganizationBillingRow(
    tx,
    org.id,
    options.initialBilling,
  );
  const container = await createRootContainer(tx, {
    organizationId: org.id,
    rootContainerId: input.rootContainerId,
    userId: input.userId,
  });
  await options.onOrganizationRootCreated?.(org.id);
  await createInitialGroup(tx, {
    groupId: input.initialAdminGroup.groupId,
    organizationId: org.id,
  });
  await createInitialGroup(tx, {
    groupId: input.initialMemberGroup.groupId,
    organizationId: org.id,
  });
  const adminPolicy = await storeInitialPolicy(
    tx,
    input.initialAdminGroup.initialGroupPolicy,
    options.identityTrustDomain,
    true,
  );
  const { policy: memberPolicy, stateHash: initialMemberGroupStateHash } =
    await storeInitialMemberGroupPolicy(tx, input, options.identityTrustDomain);
  const organizationPolicy = await storeInitialPolicy(
    tx,
    input.initialOrganizationPolicy,
    options.identityTrustDomain,
  );
  await syncInitialRosterAndBillingSeats({
    initialBilling,
    initialMemberGroupStateHash,
    organizationId: org.id,
    provisioning: input,
    tx,
  });
  return {
    organizationId: org.id,
    rootContainerId: container.id,
    verifiedPrincipalPolicies: [adminPolicy, memberPolicy, organizationPolicy],
  };
}

async function provisionOrganizationContainersAndProfiles(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
  rootMetadata: { readonly metadataDocumentId: string },
  provisioningContext: ProvisioningVerifiedContext,
) {
  const rootMetadataDocument = await createInitialRootMetadataDocument(
    tx,
    input,
    signer,
    rootMetadata,
    provisioningContext,
  );
  const rosterProfileContainer = await createInitialRosterProfileContainer(
    tx,
    input,
    signer,
    provisioningContext,
  );
  const rosterProfileDocument = await createInitialRosterProfileDocument(
    tx,
    input,
    signer,
    rosterProfileContainer?.container ?? null,
    provisioningContext,
  );
  const organizationMetadataContainer =
    await createInitialOrganizationMetadataContainer(
      tx,
      input,
      signer,
      provisioningContext,
    );
  const organizationProfileDocument =
    await createInitialOrganizationProfileDocument(
      tx,
      input,
      signer,
      organizationMetadataContainer.container,
      provisioningContext,
    );
  const systemContainers = await createProvisionedSystemContainers(
    tx,
    input,
    signer,
    provisioningContext,
  );
  return {
    organizationMetadataContainer,
    organizationProfileDocument,
    rootMetadataDocument,
    rosterProfileContainer,
    rosterProfileDocument,
    systemContainers,
  };
}

/**
 * Bootstraps a fresh organization inside the caller's transaction: org row,
 * billing, root container, reserved group policies, roster, builtin grants,
 * and system/profile containers and documents.
 */
export async function provisionOrganizationInTransaction(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
  options: ProvisionOrganizationOptions,
): Promise<ProvisionedOrganization> {
  const { organizationId, rootContainerId, verifiedPrincipalPolicies } =
    await provisionOrganizationAuthorityAndBilling(tx, input, options);
  const rootMetadata = await storeInitialRootContainer(
    tx,
    input,
    signer,
    verifiedPrincipalPolicies,
  );
  const provisioningContext = await createProvisioningVerifiedContext({
    groupIds: [
      input.initialAdminGroup.groupId,
      input.initialMemberGroup.groupId,
    ],
    organizationId,
    rootManifest: rootMetadata.verifiedManifest,
    tx,
    verifiedPrincipalPolicies,
  });
  const provisionedContainers =
    await provisionOrganizationContainersAndProfiles(
      tx,
      input,
      signer,
      rootMetadata,
      provisioningContext,
    );
  await assertProvisionedGroupGrantIndex(
    tx,
    input.initialAdminGroup.initialGroupPolicy,
  );
  await assertProvisionedGroupGrantIndex(
    tx,
    input.initialMemberGroup.initialGroupPolicy,
  );
  return {
    organizationId,
    rootBundleDigest: rootMetadata.bundleDigest,
    rootContainerId,
    rootMetadataAccessEpoch: rootMetadata.metadataAccessEpoch,
    rootMetadataAccessStateHash: rootMetadata.metadataAccessStateHash,
    rootMetadataDocumentId: rootMetadata.metadataDocumentId,
    ...provisionedContainers,
    committedCoreMetadataUpdateIds: listCommittedCoreMetadataUpdateIds(input),
    committedProfileUpdateIds: listCommittedProfileUpdateIds(input),
  };
}
