import type { DatabaseTransaction } from "@tearleads/api-shared/postgres";
import {
  containerBuiltinGrants,
  containerMetadataDocuments,
  containers,
  groups,
  organizationReadModelHeads,
  organizations,
} from "@tearleads/api-shared/schema";
import {
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  type VerifiedAccessEvent,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import type {
  OrganizationProvisioningRequest,
  ProvisionedSystemContainerRequest,
} from "@tearleads/validators/request";
import type {
  ContainerCreateWithMetadataDocumentResponse,
  OrganizationProvisioningResponse,
} from "@tearleads/validators/response";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { storeVerifiedAccessManifestInTransaction } from "../../access/write/accessManifestStore";
import { storeVerifiedContainerKekStateInTransaction } from "../../access/write/containerKekStore";
import {
  readProjectionAccessEvent,
  readProjectionAccessManifest,
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionString,
  readProjectionValue,
} from "../../keyingProjectionRecords";
import { readKeyingCanonicalJson } from "../../utils/canonicalJson";
import { createContainer } from "../containers/mutations/createContainer";
import {
  applyContainerSystemSlot,
  readContainerMetadataDocumentId,
} from "../containers/mutations/createContainerWithMetadataDocument";
import { ContainerMutationError } from "../containers/mutations/errors";
import { assertPrincipalPoliciesCurrent } from "../containers/mutations/shared/principalPolicies";
import { principalPoliciesFromRequest } from "../containers/mutations/shared/principalPolicyRecords";
import {
  createDocumentWithExecutor,
  DocumentMutationError,
} from "../documents/mutations";
import { appendProvisionedDocumentInitialUpdate } from "../documents/mutations/syncDocument";
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
import { parseOrganizationAuthorityDescriptor } from "./organizationAuthorityDescriptor";
import { OrganizationProvisioningError } from "./provisionOrganizationError";
import {
  createInitialOrganizationProfileDocument,
  createInitialRosterProfileDocument,
  readDocumentCreateRequestId,
} from "./provisionOrganizationProfiles";

export { OrganizationProvisioningError } from "./provisionOrganizationError";

const ADMIN_GROUP_NAME = "Admins";
const MEMBER_GROUP_NAME = "Members";

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

function provisioningShapeError(
  message: string,
): OrganizationProvisioningError {
  return new OrganizationProvisioningError(message, 400);
}
function isKekRecipientKind(
  value: unknown,
): value is ContainerKeyWrap["recipientKind"] {
  return (
    value === "container" ||
    value === "group" ||
    value === "organization" ||
    value === "user"
  );
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

function validateInitialOrganizationPolicyInput(
  input: OrganizationProvisioningRequest,
  signingFingerprint: string,
  encapsulationFingerprint: string,
) {
  const { encryptedPayload, memberEnvelopes, projection, state } =
    input.initialOrganizationPolicy;

  const descriptor = parseOrganizationAuthorityDescriptor(
    encryptedPayload.ciphertext,
  );
  if (
    !descriptor ||
    descriptor.organizationId !== input.organizationId ||
    descriptor.adminGroupId !== input.initialAdminGroup.groupId ||
    descriptor.memberGroupId !== input.initialMemberGroup.groupId
  ) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy authority descriptor must bind the reserved groups",
      400,
    );
  }

  if (
    state.principalType !== "organization" ||
    state.principalId !== input.organizationId
  ) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy state must target the registered organization",
      400,
    );
  }

  if (
    state.signerUserId !== input.userId ||
    state.signerUserKeyFingerprint !== signingFingerprint
  ) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy signer must match the registering user",
      400,
    );
  }

  if (
    state.version !== 1 ||
    state.prevStateHash !== null ||
    state.keyEpoch !== 1
  ) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy state must be the first organization state",
      400,
    );
  }

  const onlyProjectionMember = projection[0];
  if (
    projection.length !== 1 ||
    !onlyProjectionMember ||
    onlyProjectionMember.memberPrincipalType !== "user" ||
    onlyProjectionMember.memberPrincipalId !== input.userId ||
    onlyProjectionMember.role !== "admin" ||
    state.memberCount !== 1
  ) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy projection must contain the registering user as sole admin",
      400,
    );
  }

  const onlyMemberEnvelope = memberEnvelopes[0];
  if (
    memberEnvelopes.length !== 1 ||
    !onlyMemberEnvelope ||
    onlyMemberEnvelope.memberPrincipalType !== "user" ||
    onlyMemberEnvelope.memberPrincipalId !== input.userId ||
    onlyMemberEnvelope.memberKeyFingerprint !== encapsulationFingerprint
  ) {
    throw new OrganizationProvisioningError(
      "initialOrganizationPolicy member envelope must wrap the registering user",
      400,
    );
  }
}

function validateInitialAdminGroupInput(
  input: OrganizationProvisioningRequest,
  signingFingerprint: string,
  encapsulationFingerprint: string,
) {
  const { groupId, initialGroupPolicy } = input.initialAdminGroup;
  const { memberEnvelopes, projection, state } = initialGroupPolicy;

  if (input.initialAdminGroup.name.trim() !== ADMIN_GROUP_NAME) {
    throw new OrganizationProvisioningError(
      "initialAdminGroup name must be Admins",
      400,
    );
  }

  if (state.principalType !== "group" || state.principalId !== groupId) {
    throw new OrganizationProvisioningError(
      "initialAdminGroup policy state must target the admin group",
      400,
    );
  }

  if (
    state.signerUserId !== input.userId ||
    state.signerUserKeyFingerprint !== signingFingerprint
  ) {
    throw new OrganizationProvisioningError(
      "initialAdminGroup policy signer must match the registering user",
      400,
    );
  }

  if (
    state.version !== 1 ||
    state.prevStateHash !== null ||
    state.keyEpoch !== 1
  ) {
    throw new OrganizationProvisioningError(
      "initialAdminGroup policy state must be the first group state",
      400,
    );
  }

  const onlyProjectionMember = projection[0];
  if (
    projection.length !== 1 ||
    !onlyProjectionMember ||
    onlyProjectionMember.memberPrincipalType !== "user" ||
    onlyProjectionMember.memberPrincipalId !== input.userId ||
    onlyProjectionMember.role !== "admin" ||
    state.memberCount !== 1
  ) {
    throw new OrganizationProvisioningError(
      "initialAdminGroup policy projection must contain the registering user as sole admin",
      400,
    );
  }

  const onlyMemberEnvelope = memberEnvelopes[0];
  if (
    memberEnvelopes.length !== 1 ||
    !onlyMemberEnvelope ||
    onlyMemberEnvelope.memberPrincipalType !== "user" ||
    onlyMemberEnvelope.memberPrincipalId !== input.userId ||
    onlyMemberEnvelope.memberKeyFingerprint !== encapsulationFingerprint
  ) {
    throw new OrganizationProvisioningError(
      "initialAdminGroup member envelope must wrap the registering user",
      400,
    );
  }
}

function validateInitialMemberGroupInput(
  input: OrganizationProvisioningRequest,
  signingFingerprint: string,
  encapsulationFingerprint: string,
) {
  const { groupId, initialGroupPolicy } = input.initialMemberGroup;
  const { memberEnvelopes, projection, state } = initialGroupPolicy;

  if (groupId === input.initialAdminGroup.groupId) {
    throw new OrganizationProvisioningError(
      "initialMemberGroup must be distinct from initialAdminGroup",
      400,
    );
  }

  if (input.initialMemberGroup.name.trim() !== MEMBER_GROUP_NAME) {
    throw new OrganizationProvisioningError(
      "initialMemberGroup name must be Members",
      400,
    );
  }

  if (state.principalType !== "group" || state.principalId !== groupId) {
    throw new OrganizationProvisioningError(
      "initialMemberGroup policy state must target the member group",
      400,
    );
  }

  if (
    state.signerUserId !== input.userId ||
    state.signerUserKeyFingerprint !== signingFingerprint
  ) {
    throw new OrganizationProvisioningError(
      "initialMemberGroup policy signer must match the registering user",
      400,
    );
  }

  if (
    state.version !== 1 ||
    state.prevStateHash !== null ||
    state.keyEpoch !== 1
  ) {
    throw new OrganizationProvisioningError(
      "initialMemberGroup policy state must be the first group state",
      400,
    );
  }

  const userMember = projection.find(
    (member) =>
      member.memberPrincipalType === "user" &&
      member.memberPrincipalId === input.userId,
  );
  const adminGroupMember = projection.find(
    (member) =>
      member.memberPrincipalType === "group" &&
      member.memberPrincipalId === input.initialAdminGroup.groupId,
  );
  if (
    projection.length !== 2 ||
    userMember?.role !== "admin" ||
    adminGroupMember?.role !== "member" ||
    state.memberCount !== 2
  ) {
    throw new OrganizationProvisioningError(
      "initialMemberGroup policy must contain the registering user as admin and Admins as member",
      400,
    );
  }

  const userEnvelope = memberEnvelopes.find(
    (envelope) =>
      envelope.memberPrincipalType === "user" &&
      envelope.memberPrincipalId === input.userId,
  );
  const adminGroupEnvelope = memberEnvelopes.find(
    (envelope) =>
      envelope.memberPrincipalType === "group" &&
      envelope.memberPrincipalId === input.initialAdminGroup.groupId,
  );
  if (
    memberEnvelopes.length !== 2 ||
    userEnvelope?.memberKeyFingerprint !== encapsulationFingerprint ||
    adminGroupEnvelope?.memberKeyFingerprint !==
      input.initialAdminGroup.initialGroupPolicy.state.keyFingerprint
  ) {
    throw new OrganizationProvisioningError(
      "initialMemberGroup member envelopes must wrap the registering user and Admins group",
      400,
    );
  }
}

async function storeInitialOrganizationPolicy(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
) {
  await storeVerifiedPrincipalPolicyInTransaction(
    {
      state: input.initialOrganizationPolicy.state,
      encryptedPayload: input.initialOrganizationPolicy.encryptedPayload,
      projection: input.initialOrganizationPolicy.projection,
      memberEnvelopes: input.initialOrganizationPolicy.memberEnvelopes,
    },
    tx,
  );
}

async function createInitialAdminGroup(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  organizationId: string,
) {
  const [group] = await tx
    .insert(groups)
    .values({
      id: input.initialAdminGroup.groupId,
      organizationId,
      name: ADMIN_GROUP_NAME,
    })
    .returning({ id: groups.id });

  if (!group) {
    throw new OrganizationProvisioningError(
      "Failed to create admin group",
      500,
    );
  }

  return group;
}

async function createInitialMemberGroup(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  organizationId: string,
) {
  const [group] = await tx
    .insert(groups)
    .values({
      id: input.initialMemberGroup.groupId,
      organizationId,
      name: MEMBER_GROUP_NAME,
    })
    .returning({ id: groups.id });

  if (!group) {
    throw new OrganizationProvisioningError(
      "Failed to create member group",
      500,
    );
  }

  return group;
}

async function storeInitialAdminGroupPolicy(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
) {
  const { initialGroupPolicy } = input.initialAdminGroup;
  await storeVerifiedPrincipalPolicyInTransaction(
    {
      state: initialGroupPolicy.state,
      encryptedPayload: initialGroupPolicy.encryptedPayload,
      projection: initialGroupPolicy.projection,
      memberEnvelopes: initialGroupPolicy.memberEnvelopes,
    },
    tx,
  );
}

function readInitialRootContainerMetadataDocumentId(
  input: OrganizationProvisioningRequest,
): string {
  const body = input.initialRootContainer.body;
  const metadataDocumentId =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? Reflect.get(body, "metadataDocumentId")
      : null;

  return typeof metadataDocumentId === "string" && metadataDocumentId.length > 0
    ? metadataDocumentId
    : "";
}

function requireRootVerification<T>(
  result:
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: Error },
): T {
  if (result.ok) {
    return result.value;
  }

  throw new OrganizationProvisioningError(result.error.message, 400);
}

function assertInitialRootEventMatchesRegistration(input: {
  event: VerifiedAccessEvent;
  fingerprint: string;
  registration: OrganizationProvisioningRequest;
}): void {
  const { event, fingerprint, registration } = input;

  if (
    event.event.eventType !== "container.create" ||
    event.event.objectKind !== "container" ||
    event.event.objectId !== registration.rootContainerId ||
    event.event.organizationId !== registration.organizationId ||
    event.event.signerUserId !== registration.userId ||
    event.event.signerKeyFingerprint !== fingerprint
  ) {
    throw new OrganizationProvisioningError(
      "Initial root container event does not match registration",
      400,
    );
  }
}

function readContainerKeyEpoch(
  value: unknown,
  label: string,
): ContainerKeyEpoch {
  const record = readProjectionPlainRecord(
    value,
    label,
    provisioningShapeError,
  );
  return {
    id: readProjectionString(record, "id", label, provisioningShapeError),
    containerId: readProjectionString(
      record,
      "containerId",
      label,
      provisioningShapeError,
    ),
    keyEpoch: readProjectionPositiveInteger(
      record,
      "keyEpoch",
      label,
      provisioningShapeError,
    ),
    accessManifestHash: readProjectionString(
      record,
      "accessManifestHash",
      label,
      provisioningShapeError,
    ),
    parentContainerKeyEpochId: readProjectionNullableString(
      record,
      "parentContainerKeyEpochId",
      label,
      provisioningShapeError,
    ),
    createdByEventHash: readProjectionString(
      record,
      "createdByEventHash",
      label,
      provisioningShapeError,
    ),
    createdByManifestHash: readProjectionString(
      record,
      "createdByManifestHash",
      label,
      provisioningShapeError,
    ),
  };
}

function readContainerUserRecipientKey(
  value: unknown,
  label: string,
): ContainerUserRecipientKey {
  const record = readProjectionPlainRecord(
    value,
    label,
    provisioningShapeError,
  );

  return {
    userId: readProjectionString(
      record,
      "userId",
      label,
      provisioningShapeError,
    ),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      provisioningShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      provisioningShapeError,
    ),
  };
}

function readContainerUserRecipientKeys(
  value: unknown,
  label: string,
): ContainerUserRecipientKey[] {
  if (!Array.isArray(value)) {
    throw provisioningShapeError(`${label} is invalid`);
  }

  return value.map((entry, index) =>
    readContainerUserRecipientKey(entry, `${label}[${index}]`),
  );
}

function readContainerKeyWrap(value: unknown, label: string): ContainerKeyWrap {
  const record = readProjectionPlainRecord(
    value,
    label,
    provisioningShapeError,
  );
  const recipientKind = readProjectionValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw provisioningShapeError(`${label}.recipientKind is invalid`);
  }

  return {
    containerKeyEpochId: readProjectionString(
      record,
      "containerKeyEpochId",
      label,
      provisioningShapeError,
    ),
    recipientKind,
    recipientId: readProjectionString(
      record,
      "recipientId",
      label,
      provisioningShapeError,
    ),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      provisioningShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      provisioningShapeError,
    ),
    kemCipherText: readProjectionString(
      record,
      "kemCipherText",
      label,
      provisioningShapeError,
    ),
    wrappedKey: readProjectionString(
      record,
      "wrappedKey",
      label,
      provisioningShapeError,
    ),
    wrapManifestHash: readProjectionString(
      record,
      "wrapManifestHash",
      label,
      provisioningShapeError,
    ),
  };
}

function readContainerKeyWraps(
  value: unknown,
  label: string,
): ContainerKeyWrap[] {
  if (!Array.isArray(value)) {
    throw provisioningShapeError(`${label} is invalid`);
  }

  return value.map((entry, index) =>
    readContainerKeyWrap(entry, `${label}[${index}]`),
  );
}

function assertInitialRootHasNoPredecessor(
  request: OrganizationProvisioningRequest["initialRootContainer"],
): void {
  if (request.predecessorBridge !== null) {
    throw new OrganizationProvisioningError(
      "Initial root container KEK cannot have a predecessor bridge",
      400,
    );
  }
}

async function storeInitialRootContainer(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
): Promise<{
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string;
}> {
  const request = input.initialRootContainer;
  assertInitialRootHasNoPredecessor(request);
  const metadataDocumentId = readInitialRootContainerMetadataDocumentId(input);
  const principalPolicies = principalPoliciesFromRequest(request);
  await assertPrincipalPoliciesCurrent(tx, principalPolicies);

  const event = requireRootVerification(
    await verifySignedAccessEvent({
      body: readKeyingCanonicalJson(
        request.body,
        "Initial root container event body",
      ),
      event: readProjectionAccessEvent(
        request.event,
        "Initial root container event",
        provisioningShapeError,
      ),
      signerPublicKey: signer.signingPublicKey,
    }),
  );

  assertInitialRootEventMatchesRegistration({
    event,
    fingerprint: signer.fingerprint,
    registration: input,
  });

  const manifest = requireRootVerification(
    await verifyContainerAccessManifest({
      event,
      expectedManifestHash: request.expectedManifestHash,
      manifest: readProjectionAccessManifest(
        request.manifest,
        "Initial root container manifest",
        provisioningShapeError,
      ),
      parentContainerPath: [],
      principalPolicies,
      previousManifest: null,
    }),
  );

  if (
    manifest.state.containerId !== input.rootContainerId ||
    manifest.state.organizationId !== input.organizationId ||
    manifest.state.parentContainerId !== null ||
    manifest.state.parentManifestHash !== null ||
    manifest.state.metadataDocumentId !== metadataDocumentId
  ) {
    throw new OrganizationProvisioningError(
      "Initial root container manifest does not match registration",
      400,
    );
  }

  const kekState = requireRootVerification(
    await verifyContainerKekState({
      containerManifest: manifest,
      keyEpoch: readContainerKeyEpoch(
        request.keyEpoch,
        "Initial root container key epoch",
      ),
      userRecipientKeys: readContainerUserRecipientKeys(
        request.userRecipientKeys,
        "Initial root container user recipient keys",
      ),
      wraps: readContainerKeyWraps(
        request.wraps,
        "Initial root container wraps",
      ),
      principalPolicies,
    }),
  );

  await storeVerifiedAccessManifestInTransaction(
    { verifiedManifest: manifest },
    tx,
  );
  await storeVerifiedContainerKekStateInTransaction(
    { predecessorBridge: null, verifiedState: kekState },
    tx,
  );
  return {
    metadataAccessEpoch: manifest.state.epoch,
    metadataAccessStateHash: manifest.manifestHash,
    metadataDocumentId: manifest.state.metadataDocumentId,
  };
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

/**
 * Records the organization-metadata container's read grant to the reserved
 * Members group as a built-in grant.
 *
 * Like the root -> Admins grant, this is a reserved system grant: Members must
 * never lose it (revoking it permanently strips their ability to decrypt the org
 * display name, with no self-heal — the client metadata re-wrap only refreshes a
 * verified existing grant and refuses to mint, a metadata->Members analog of the
 * root/Admins lockout). Unlike root -> Admins it is not admin-frozen: it must
 * still be re-wrapped on every Members-group key rotation. Recording it here lets
 * the built-in-grant guard reject a revoke / access-level change while still
 * permitting the same-level "read" re-wrap (assertContainerBuiltinGrantPolicyPreserved),
 * and flips the org-manager UI's computed isBuiltin flag so the grant renders as
 * built-in rather than revocable.
 */
async function createOrganizationMetadataBuiltinGrant(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  organizationId: string,
  metadataContainerId: string,
): Promise<void> {
  await tx.insert(containerBuiltinGrants).values({
    accessLevel: "read",
    containerId: metadataContainerId,
    organizationId,
    subjectId: input.initialMemberGroup.groupId,
    subjectType: "group",
  });
}

function readInitialRootMetadataDocumentId(
  input: OrganizationProvisioningRequest,
): string {
  return readDocumentCreateRequestId(input.initialRootMetadataDocument);
}

async function createInitialRootMetadataDocument(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
  rootMetadata: {
    metadataDocumentId: string;
  },
) {
  const requestDocumentId = readInitialRootMetadataDocumentId(input);
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

async function createProvisionedSystemContainer(
  tx: DatabaseTransaction,
  input: {
    request: ProvisionedSystemContainerRequest;
    signer: OrganizationProvisioningSigner;
    userId: string;
  },
): Promise<ContainerCreateWithMetadataDocumentResponse> {
  const container = await createContainer({
    executor: tx,
    fingerprint: input.signer.fingerprint,
    request: input.request.container,
    userId: input.userId,
  });
  const metadataDocumentId = readContainerMetadataDocumentId(container);

  const metadataDocument = await createDocumentWithExecutor({
    executor: tx,
    fingerprint: input.signer.fingerprint,
    request: input.request.metadataDocument,
    userId: input.userId,
  });
  if (metadataDocument.id !== metadataDocumentId) {
    throw new OrganizationProvisioningError(
      "Provisioned system container metadata document mismatch",
      400,
    );
  }
  await appendProvisionedDocumentInitialUpdate({
    documentId: metadataDocument.id,
    executor: tx,
    fingerprint: input.signer.fingerprint,
    request: input.request.initialMetadataSync,
    signingPublicKey: input.signer.signingPublicKey,
    userId: input.userId,
  });

  const systemSlot = input.request.systemSlot ?? null;
  const nextContainer = systemSlot
    ? await applyContainerSystemSlot(tx, {
        container,
        slot: systemSlot,
      })
    : container;

  return { container: nextContainer, metadataDocument };
}

async function createInitialRosterProfileContainer(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
): Promise<ContainerCreateWithMetadataDocumentResponse | null> {
  if (!input.initialRosterProfileContainer) {
    return null;
  }
  if (!input.initialRosterProfileDocument) {
    throw new OrganizationProvisioningError(
      "Initial roster profile container requires a roster profile document",
      400,
    );
  }

  return createProvisionedSystemContainer(tx, {
    request: input.initialRosterProfileContainer,
    signer,
    userId: input.userId,
  });
}

async function createInitialOrganizationMetadataContainer(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
): Promise<ContainerCreateWithMetadataDocumentResponse | null> {
  if (!input.initialOrganizationMetadataContainer) {
    return null;
  }
  if (!input.initialOrganizationProfileDocument) {
    throw new OrganizationProvisioningError(
      "Initial organization metadata container requires an organization profile document",
      400,
    );
  }

  const metadataContainer = await createProvisionedSystemContainer(tx, {
    request: input.initialOrganizationMetadataContainer,
    signer,
    userId: input.userId,
  });
  await createOrganizationMetadataBuiltinGrant(
    tx,
    input,
    input.organizationId,
    metadataContainer.container.containerId,
  );
  return metadataContainer;
}

async function createProvisionedSystemContainers(
  tx: DatabaseTransaction,
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
): Promise<ContainerCreateWithMetadataDocumentResponse[]> {
  const created: ContainerCreateWithMetadataDocumentResponse[] = [];
  for (const request of input.initialSystemContainers ?? []) {
    const provisioned = await createProvisionedSystemContainer(tx, {
      request,
      signer,
      userId: input.userId,
    });
    created.push(provisioned);
  }
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
  rootMetadataDocument: Awaited<
    ReturnType<typeof createInitialRootMetadataDocument>
  >;
  rosterProfileContainer: Awaited<
    ReturnType<typeof createInitialRosterProfileContainer>
  >;
  rosterProfileDocument: Awaited<
    ReturnType<typeof createInitialRosterProfileDocument>
  >;
  organizationMetadataContainer: Awaited<
    ReturnType<typeof createInitialOrganizationMetadataContainer>
  >;
  organizationProfileDocument: Awaited<
    ReturnType<typeof createInitialOrganizationProfileDocument>
  >;
  systemContainers: Awaited<
    ReturnType<typeof createProvisionedSystemContainers>
  >;
  committedCoreMetadataUpdateIds: string[];
  committedProfileUpdateIds: string[];
}

/**
 * Validates that the client-signed provisioning artifacts are internally
 * consistent and signed by the founding admin. Shared by user registration and
 * additional-organization creation; throws {@link OrganizationProvisioningError}
 * (400) on any mismatch.
 */
export function validateOrganizationProvisioningInput(
  input: OrganizationProvisioningRequest,
  signer: OrganizationProvisioningSigner,
): void {
  validateInitialOrganizationPolicyInput(
    input,
    signer.fingerprint,
    signer.encapsulationFingerprint,
  );
  validateInitialAdminGroupInput(
    input,
    signer.fingerprint,
    signer.encapsulationFingerprint,
  );
  validateInitialMemberGroupInput(
    input,
    signer.fingerprint,
    signer.encapsulationFingerprint,
  );
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
  await lockProvisioningOrganizationPrincipalId(tx, input);
  await lockProvisioningGroupPrincipalIds(tx, input);
  const org = await createOrganizationRow(tx, {
    adminGroupId: input.initialAdminGroup.groupId,
    memberGroupId: input.initialMemberGroup.groupId,
    organizationId: input.organizationId,
    name: options.organizationName,
  });
  await createInitialOrganizationBillingRow(tx, org.id, options.initialBilling);
  const container = await createRootContainer(
    tx,
    input.rootContainerId,
    org.id,
  );
  await options.onOrganizationRootCreated?.(org.id);
  await createInitialAdminGroup(tx, input, org.id);
  await createInitialMemberGroup(tx, input, org.id);
  await storeInitialAdminGroupPolicy(tx, input);
  const initialMemberGroupStateHash = await storeInitialMemberGroupPolicy(
    tx,
    input,
  );
  await storeInitialOrganizationPolicy(tx, input);
  await syncInitialRosterAndBillingSeats({
    initialMemberGroupStateHash,
    organizationId: org.id,
    provisioning: input,
    tx,
  });
  const rootMetadata = await storeInitialRootContainer(tx, input, signer);
  await createInitialBuiltinGrants(tx, input, org.id);
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
  return {
    organizationId: org.id,
    rootContainerId: container.id,
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

/**
 * Projects a {@link ProvisionedOrganization} into the wire response shared by
 * registration and additional-organization creation, flattening the optional
 * roster/organization profile artifacts into their id fields. `userId` is the
 * founding admin (the new user for registration, the caller otherwise).
 */
export function toOrganizationProvisioningResponse(
  userId: string,
  provisioned: ProvisionedOrganization,
): OrganizationProvisioningResponse {
  return {
    userId,
    organizationId: provisioned.organizationId,
    rootContainerId: provisioned.rootContainerId,
    rootMetadataDocumentId: provisioned.rootMetadataDocumentId,
    rootMetadataAccessEpoch: provisioned.rootMetadataAccessEpoch,
    rootMetadataAccessStateHash: provisioned.rootMetadataAccessStateHash,
    rootMetadataDocument: provisioned.rootMetadataDocument,
    committedCoreMetadataUpdateIds: provisioned.committedCoreMetadataUpdateIds,
    committedProfileUpdateIds: provisioned.committedProfileUpdateIds,
    ...(provisioned.rosterProfileContainer
      ? {
          rosterProfileContainer: provisioned.rosterProfileContainer,
          rosterProfileContainerId:
            provisioned.rosterProfileContainer.container.containerId,
        }
      : {}),
    ...(provisioned.rosterProfileDocument
      ? {
          rosterProfileDocument: provisioned.rosterProfileDocument,
          rosterProfileDocumentId: provisioned.rosterProfileDocument.id,
        }
      : {}),
    ...(provisioned.organizationMetadataContainer
      ? {
          organizationMetadataContainer:
            provisioned.organizationMetadataContainer,
          organizationMetadataContainerId:
            provisioned.organizationMetadataContainer.container.containerId,
        }
      : {}),
    ...(provisioned.organizationProfileDocument
      ? {
          organizationProfileDocument: provisioned.organizationProfileDocument,
          organizationProfileDocumentId:
            provisioned.organizationProfileDocument.id,
        }
      : {}),
    systemContainers: provisioned.systemContainers,
  };
}
