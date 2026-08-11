import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  containerBuiltinGrants,
  containerMetadataDocuments,
  containers,
  groups,
  organizationReadModelHeads,
  organizations,
} from "@tearleads/api-shared/schema";
import { normalizePrincipalContainerGrants } from "@tearleads/crypto";
import type {
  OrganizationProvisioningRequest,
  PutPrincipalPolicyRequest,
} from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  DocumentCreateResponse,
} from "@tearleads/validators/response";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { ContainerMutationError } from "../containers/mutations/errors";
import {
  createDocumentWithExecutor,
  DocumentMutationError,
} from "../documents/mutations";
import { appendProvisionedDocumentInitialUpdate } from "../documents/mutations/syncDocument";
import { listCurrentPrincipalContainerGrants } from "../principals/principalContainerRematerialization";
import { lockPrincipalMutationInTransaction } from "../principals/principalMutationLock";
import { toPrincipalPolicyError } from "../principals/shared";
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
import {
  createInitialOrganizationMetadataContainer,
  createInitialRosterProfileContainer,
  createProvisionedSystemContainers,
} from "./provisionOrganizationSystemContainers";
import {
  ADMIN_GROUP_NAME,
  MEMBER_GROUP_NAME,
} from "./provisionOrganizationValidation";

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
    name: string;
  },
) {
  const [org] = await tx
    .insert(organizations)
    .values({
      adminGroupId: input.adminGroupId,
      id: input.organizationId,
      memberGroupId: input.memberGroupId,
      name: input.name,
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

async function createRootContainer(
  tx: DatabaseTransaction,
  rootContainerId: string,
  organizationId: string,
) {
  const [container] = await tx
    .insert(containers)
    .values({
      depth: 0,
      id: rootContainerId,
      organizationId,
      parentId: null,
    })
    .returning({ id: containers.id });
  if (!container) {
    throw new Error("Failed to create root container");
  }
  return container;
}

async function createInitialGroup(
  tx: DatabaseTransaction,
  input: { groupId: string; name: string; organizationId: string },
): Promise<void> {
  const [group] = await tx
    .insert(groups)
    .values({
      id: input.groupId,
      organizationId: input.organizationId,
      name: input.name,
    })
    .returning({ id: groups.id });

  if (!group) {
    throw new OrganizationProvisioningError(
      `Failed to create ${input.name} group`,
      500,
    );
  }
}

async function storeInitialPolicy(
  tx: DatabaseTransaction,
  bundle: PutPrincipalPolicyRequest,
): Promise<void> {
  await storeVerifiedPrincipalPolicyInTransaction(
    {
      state: bundle.state,
      encryptedPayload: bundle.encryptedPayload,
      projection: bundle.projection,
      grants: bundle.grants,
      memberEnvelopes: bundle.memberEnvelopes,
    },
    tx,
  );
}

async function createInitialBuiltinGrants(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  organizationId: string,
): Promise<void> {
  await tx.insert(containerBuiltinGrants).values({
    accessLevel: "admin",
    containerId: input.rootContainerId,
    organizationId,
    subjectId: input.initialAdminGroup.groupId,
    subjectType: "group",
  });
}

async function assertProvisionedGroupGrantIndex(
  tx: DatabaseTransaction,
  policy: PutPrincipalPolicyRequest,
): Promise<void> {
  const expected = normalizePrincipalContainerGrants(policy.grants);
  const actual = await listCurrentPrincipalContainerGrants({
    executor: tx,
    principalId: policy.state.principalId,
    principalType: "group",
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

  const created = await createDocumentWithExecutor({
    executor: tx,
    fingerprint: signer.fingerprint,
    request: input.initialRootMetadataDocument,
    userId: input.userId,
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
    request: input.initialRootMetadataDocument.initialSync,
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
    input.initialOrganizationMetadataContainer?.initialMetadataSync,
  ].flatMap((initialSync) =>
    initialSync ? initialSync.outgoingUpdates.map((update) => update.id) : [],
  );
}

export interface ProvisionOrganizationOptions {
  readonly initialBilling: InitialOrganizationBilling;
  /**
   * Server-side plaintext organization label. The real display name lives in
   * the encrypted organization profile document; this is only a coarse label.
   */
  readonly organizationName: string;
  /**
   * Invoked in-transaction immediately after the organization row and its root
   * container are created, before groups/policies/roster are stored.
   * Registration uses this to insert the founding user row with the new
   * organization as their default; creating an additional organization omits it
   * (the founding user already exists).
   */
  readonly onOrganizationRootCreated?:
    | ((organizationId: string) => Promise<void>)
    | undefined;
}

export interface ProvisionedOrganization {
  organizationId: string;
  rootContainerId: string;
  rootMetadataAccessEpoch: number;
  rootMetadataAccessStateHash: string;
  rootMetadataDocumentId: string;
  rootMetadataDocument: DocumentCreateResponse;
  rosterProfileContainer: ContainerCreateWithMetadataDocumentResponse | null;
  rosterProfileDocument: DocumentCreateResponse | null;
  organizationMetadataContainer: ContainerCreateWithMetadataDocumentResponse | null;
  organizationProfileDocument: DocumentCreateResponse | null;
  systemContainers: ContainerCreateWithMetadataDocumentResponse[];
  committedCoreMetadataUpdateIds: string[];
  committedProfileUpdateIds: string[];
}

async function provisionOrganizationAuthorityAndBilling(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  options: ProvisionOrganizationOptions,
): Promise<{ organizationId: string; rootContainerId: string }> {
  await lockProvisioningOrganizationPrincipalId(tx, input);
  await lockProvisioningGroupPrincipalIds(tx, input);
  const org = await createOrganizationRow(tx, {
    adminGroupId: input.initialAdminGroup.groupId,
    memberGroupId: input.initialMemberGroup.groupId,
    organizationId: input.organizationId,
    name: options.organizationName,
  });
  const initialBilling = await createInitialOrganizationBillingRow(
    tx,
    org.id,
    options.initialBilling,
  );
  const container = await createRootContainer(
    tx,
    input.rootContainerId,
    org.id,
  );
  await options.onOrganizationRootCreated?.(org.id);
  await createInitialGroup(tx, {
    groupId: input.initialAdminGroup.groupId,
    name: ADMIN_GROUP_NAME,
    organizationId: org.id,
  });
  await createInitialGroup(tx, {
    groupId: input.initialMemberGroup.groupId,
    name: MEMBER_GROUP_NAME,
    organizationId: org.id,
  });
  await storeInitialPolicy(tx, input.initialAdminGroup.initialGroupPolicy);
  const initialMemberGroupStateHash = await storeInitialMemberGroupPolicy(
    tx,
    input,
  );
  await storeInitialPolicy(tx, input.initialOrganizationPolicy);
  await syncInitialRosterAndBillingSeats({
    initialBilling,
    initialMemberGroupStateHash,
    organizationId: org.id,
    provisioning: input,
    tx,
  });
  return { organizationId: org.id, rootContainerId: container.id };
}

/**
 * Bootstraps a fresh organization from the client-signed provisioning
 * artifacts, inside the caller's transaction: the organization row + initial
 * billing, the root container and its verified access manifest/KEK state, the
 * admin/member group policies, the initial roster, builtin grants, and the
 * optional roster/organization profile documents. The founding admin
 * (`input.userId`) must already exist by the time roster sync runs — pass
 * `options.onOrganizationRootCreated` to create it (registration) or ensure it
 * exists beforehand (additional organization).
 */
export async function provisionOrganizationInTransaction(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
  options: ProvisionOrganizationOptions,
): Promise<ProvisionedOrganization> {
  const { organizationId, rootContainerId } =
    await provisionOrganizationAuthorityAndBilling(tx, input, options);
  const rootMetadata = await storeInitialRootContainer(tx, input, signer);
  await createInitialBuiltinGrants(tx, input, organizationId);
  const rootMetadataDocument = await createInitialRootMetadataDocument(
    tx,
    input,
    signer,
    rootMetadata,
  );
  const rosterProfileContainer = await createInitialRosterProfileContainer(
    tx,
    input,
    signer,
  );
  const rosterProfileDocument = await createInitialRosterProfileDocument(
    tx,
    input,
    signer,
    rosterProfileContainer?.container ?? null,
  );
  const organizationMetadataContainer =
    await createInitialOrganizationMetadataContainer(tx, input, signer);
  const organizationProfileDocument =
    await createInitialOrganizationProfileDocument(
      tx,
      input,
      signer,
      organizationMetadataContainer?.container ?? null,
    );
  const systemContainers = await createProvisionedSystemContainers(
    tx,
    input,
    signer,
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
    rootContainerId,
    rootMetadataAccessEpoch: rootMetadata.metadataAccessEpoch,
    rootMetadataAccessStateHash: rootMetadata.metadataAccessStateHash,
    rootMetadataDocumentId: rootMetadata.metadataDocumentId,
    rootMetadataDocument,
    rosterProfileContainer,
    rosterProfileDocument,
    organizationMetadataContainer,
    organizationProfileDocument,
    systemContainers,
    committedCoreMetadataUpdateIds: listCommittedCoreMetadataUpdateIds(input),
    committedProfileUpdateIds: listCommittedProfileUpdateIds(input),
  };
}

/**
 * Maps the principal-policy / document / container mutation errors raised while
 * storing provisioning artifacts into a status-bearing
 * {@link OrganizationProvisioningError}. Returns null for unrelated errors so
 * the caller can rethrow.
 */
export function toOrganizationProvisioningError(
  error: unknown,
): OrganizationProvisioningError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  const policyError = toPrincipalPolicyError(error);
  if (policyError) {
    return new OrganizationProvisioningError(
      policyError.message,
      policyError.status,
    );
  }

  if (
    error instanceof DocumentMutationError ||
    error instanceof ContainerMutationError
  ) {
    return new OrganizationProvisioningError(error.message, error.status);
  }

  return null;
}
