import {
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  type VerifiedAccessEvent,
  verifyContainerAccessManifest,
  verifyContainerKekState,
  verifySignedAccessEvent,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { RegistrationRequest } from "@tearleads/validators/request";
import { storeVerifiedAccessManifestInTransaction } from "../../access/write/accessManifestStore";
import { storeVerifiedContainerKekStateInTransaction } from "../../access/write/containerKekStore";
import { replaceCurrentPrincipalMemberEnvelopesInTransaction } from "../../access/write/principalMemberEnvelopes";
import { storeVerifiedPrincipalStateInTransaction } from "../../access/write/principalStateStore";
import type { ApiDatabase, DatabaseTransaction } from "../../adapters/postgres";
import {
  readProjectionAccessEvent,
  readProjectionAccessManifest,
  readProjectionNullableString,
  readProjectionPlainRecord,
  readProjectionPositiveInteger,
  readProjectionString,
  readProjectionValue,
} from "../../keyingProjectionRecords";
import {
  containerBuiltinGrants,
  containerMetadataDocuments,
  containers,
  groups,
  organizations,
  users,
} from "../../schema";
import { ContainerMutationError } from "../containers/mutations/errors";
import { assertPrincipalPoliciesCurrent } from "../containers/mutations/shared/principalPolicies";
import { principalPoliciesFromRequest } from "../containers/mutations/shared/principalPolicyRecords";
import {
  createDocumentWithExecutor,
  DocumentMutationError,
} from "../documents/mutations";
import { syncOrganizationRosterFromMemberReachability } from "../organizations/roster";

const DUPLICATE_FINGERPRINT_ERROR = "REGISTRATION_DUPLICATE_FINGERPRINT";
const INITIAL_ADMIN_GROUP_NAME = "Admins";
const INITIAL_MEMBER_GROUP_NAME = "Members";

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 500 | 503,
  ) {
    super(message);
  }
}

function registerShapeError(message: string): RegistrationError {
  return new RegistrationError(message, 400);
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

async function createPersonalOrganization(
  tx: DatabaseTransaction,
  input: {
    adminGroupId: string;
    memberGroupId: string;
    organizationId: string;
  },
) {
  const [org] = await tx
    .insert(organizations)
    .values({
      adminGroupId: input.adminGroupId,
      id: input.organizationId,
      memberGroupId: input.memberGroupId,
      name: "Personal",
    })
    .returning({ id: organizations.id });
  if (!org) {
    throw new Error("Failed to create organization");
  }
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

async function createRegisteredUser(
  tx: DatabaseTransaction,
  input: {
    encapsulationFingerprint: string;
    encapsulationKeyBytes: Uint8Array;
    fingerprint: string;
    organizationId: string;
    userId: string;
    signingKeyBytes: Uint8Array;
  },
) {
  const [user] = await tx
    .insert(users)
    .values({
      id: input.userId,
      fingerprint: input.fingerprint,
      signingPublicKey: bytesToBase64(input.signingKeyBytes),
      encapsulationPublicKey: bytesToBase64(input.encapsulationKeyBytes),
      encapsulationKeyFingerprint: input.encapsulationFingerprint,
      defaultOrganizationId: input.organizationId,
    })
    .onConflictDoNothing({ target: users.fingerprint })
    .returning({ id: users.id });
  if (!user) {
    throw new Error(DUPLICATE_FINGERPRINT_ERROR);
  }
  return user;
}

function validateInitialOrganizationPolicyInput(
  input: RegistrationRequest,
  signingFingerprint: string,
  encapsulationFingerprint: string,
) {
  const { memberEnvelopes, projection, state } =
    input.initialOrganizationPolicy;

  if (
    state.principalType !== "organization" ||
    state.principalId !== input.organizationId
  ) {
    throw new RegistrationError(
      "initialOrganizationPolicy state must target the registered organization",
      400,
    );
  }

  if (
    state.signerUserId !== input.userId ||
    state.signerUserKeyFingerprint !== signingFingerprint
  ) {
    throw new RegistrationError(
      "initialOrganizationPolicy signer must match the registering user",
      400,
    );
  }

  if (
    state.version !== 1 ||
    state.prevStateHash !== null ||
    state.keyEpoch !== 1
  ) {
    throw new RegistrationError(
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
    throw new RegistrationError(
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
    throw new RegistrationError(
      "initialOrganizationPolicy member envelope must wrap the registering user",
      400,
    );
  }
}

function validateInitialAdminGroupInput(
  input: RegistrationRequest,
  signingFingerprint: string,
  encapsulationFingerprint: string,
) {
  const { groupId, initialGroupPolicy } = input.initialAdminGroup;
  const { memberEnvelopes, projection, state } = initialGroupPolicy;

  if (input.initialAdminGroup.name.trim() !== INITIAL_ADMIN_GROUP_NAME) {
    throw new RegistrationError("initialAdminGroup name must be Admins", 400);
  }

  if (state.principalType !== "group" || state.principalId !== groupId) {
    throw new RegistrationError(
      "initialAdminGroup policy state must target the admin group",
      400,
    );
  }

  if (
    state.signerUserId !== input.userId ||
    state.signerUserKeyFingerprint !== signingFingerprint
  ) {
    throw new RegistrationError(
      "initialAdminGroup policy signer must match the registering user",
      400,
    );
  }

  if (
    state.version !== 1 ||
    state.prevStateHash !== null ||
    state.keyEpoch !== 1
  ) {
    throw new RegistrationError(
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
    throw new RegistrationError(
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
    throw new RegistrationError(
      "initialAdminGroup member envelope must wrap the registering user",
      400,
    );
  }
}

function validateInitialMemberGroupInput(
  input: RegistrationRequest,
  signingFingerprint: string,
  encapsulationFingerprint: string,
) {
  const { groupId, initialGroupPolicy } = input.initialMemberGroup;
  const { memberEnvelopes, projection, state } = initialGroupPolicy;

  if (groupId === input.initialAdminGroup.groupId) {
    throw new RegistrationError(
      "initialMemberGroup must be distinct from initialAdminGroup",
      400,
    );
  }

  if (input.initialMemberGroup.name.trim() !== INITIAL_MEMBER_GROUP_NAME) {
    throw new RegistrationError("initialMemberGroup name must be Members", 400);
  }

  if (state.principalType !== "group" || state.principalId !== groupId) {
    throw new RegistrationError(
      "initialMemberGroup policy state must target the member group",
      400,
    );
  }

  if (
    state.signerUserId !== input.userId ||
    state.signerUserKeyFingerprint !== signingFingerprint
  ) {
    throw new RegistrationError(
      "initialMemberGroup policy signer must match the registering user",
      400,
    );
  }

  if (
    state.version !== 1 ||
    state.prevStateHash !== null ||
    state.keyEpoch !== 1
  ) {
    throw new RegistrationError(
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
    throw new RegistrationError(
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
    throw new RegistrationError(
      "initialMemberGroup member envelopes must wrap the registering user and Admins group",
      400,
    );
  }
}

async function storeInitialOrganizationPolicy(
  tx: DatabaseTransaction,
  input: RegistrationRequest,
) {
  const storedState = await storeVerifiedPrincipalStateInTransaction(
    {
      state: input.initialOrganizationPolicy.state,
      encryptedPayload: input.initialOrganizationPolicy.encryptedPayload,
      projection: input.initialOrganizationPolicy.projection,
    },
    tx,
  );

  await replaceCurrentPrincipalMemberEnvelopesInTransaction(
    {
      principalType: "organization",
      principalId: input.organizationId,
      stateHash: storedState.stateHash,
      envelopes: input.initialOrganizationPolicy.memberEnvelopes,
    },
    tx,
  );
}

async function createInitialAdminGroup(
  tx: DatabaseTransaction,
  input: RegistrationRequest,
  organizationId: string,
) {
  const [group] = await tx
    .insert(groups)
    .values({
      id: input.initialAdminGroup.groupId,
      organizationId,
      name: INITIAL_ADMIN_GROUP_NAME,
    })
    .returning({ id: groups.id });

  if (!group) {
    throw new RegistrationError("Failed to create admin group", 500);
  }

  return group;
}

async function createInitialMemberGroup(
  tx: DatabaseTransaction,
  input: RegistrationRequest,
  organizationId: string,
) {
  const [group] = await tx
    .insert(groups)
    .values({
      id: input.initialMemberGroup.groupId,
      organizationId,
      name: INITIAL_MEMBER_GROUP_NAME,
    })
    .returning({ id: groups.id });

  if (!group) {
    throw new RegistrationError("Failed to create member group", 500);
  }

  return group;
}

async function storeInitialAdminGroupPolicy(
  tx: DatabaseTransaction,
  input: RegistrationRequest,
) {
  const { initialGroupPolicy } = input.initialAdminGroup;
  const storedState = await storeVerifiedPrincipalStateInTransaction(
    {
      state: initialGroupPolicy.state,
      encryptedPayload: initialGroupPolicy.encryptedPayload,
      projection: initialGroupPolicy.projection,
    },
    tx,
  );

  await replaceCurrentPrincipalMemberEnvelopesInTransaction(
    {
      principalType: "group",
      principalId: input.initialAdminGroup.groupId,
      stateHash: storedState.stateHash,
      envelopes: initialGroupPolicy.memberEnvelopes,
    },
    tx,
  );
}

async function storeInitialMemberGroupPolicy(
  tx: DatabaseTransaction,
  input: RegistrationRequest,
) {
  const { initialGroupPolicy } = input.initialMemberGroup;
  const storedState = await storeVerifiedPrincipalStateInTransaction(
    {
      state: initialGroupPolicy.state,
      encryptedPayload: initialGroupPolicy.encryptedPayload,
      projection: initialGroupPolicy.projection,
    },
    tx,
  );

  await replaceCurrentPrincipalMemberEnvelopesInTransaction(
    {
      principalType: "group",
      principalId: input.initialMemberGroup.groupId,
      stateHash: storedState.stateHash,
      envelopes: initialGroupPolicy.memberEnvelopes,
    },
    tx,
  );
}

function readInitialRootContainerMetadataDocumentId(
  input: RegistrationRequest,
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

  throw new RegistrationError(result.error.message, 400);
}

function assertInitialRootEventMatchesRegistration(input: {
  event: VerifiedAccessEvent;
  fingerprint: string;
  registration: RegistrationRequest;
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
    throw new RegistrationError(
      "Initial root container event does not match registration",
      400,
    );
  }
}

function readContainerKeyEpoch(
  value: unknown,
  label: string,
): ContainerKeyEpoch {
  const record = readProjectionPlainRecord(value, label, registerShapeError);
  return {
    id: readProjectionString(record, "id", label, registerShapeError),
    containerId: readProjectionString(
      record,
      "containerId",
      label,
      registerShapeError,
    ),
    keyEpoch: readProjectionPositiveInteger(
      record,
      "keyEpoch",
      label,
      registerShapeError,
    ),
    accessManifestHash: readProjectionString(
      record,
      "accessManifestHash",
      label,
      registerShapeError,
    ),
    parentContainerKeyEpochId: readProjectionNullableString(
      record,
      "parentContainerKeyEpochId",
      label,
      registerShapeError,
    ),
    createdByEventHash: readProjectionString(
      record,
      "createdByEventHash",
      label,
      registerShapeError,
    ),
    createdByManifestHash: readProjectionString(
      record,
      "createdByManifestHash",
      label,
      registerShapeError,
    ),
  };
}

function readContainerUserRecipientKey(
  value: unknown,
  label: string,
): ContainerUserRecipientKey {
  const record = readProjectionPlainRecord(value, label, registerShapeError);

  return {
    userId: readProjectionString(record, "userId", label, registerShapeError),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      registerShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      registerShapeError,
    ),
  };
}

function readContainerUserRecipientKeys(
  value: unknown,
  label: string,
): ContainerUserRecipientKey[] {
  if (!Array.isArray(value)) {
    throw registerShapeError(`${label} is invalid`);
  }

  return value.map((entry, index) =>
    readContainerUserRecipientKey(entry, `${label}[${index}]`),
  );
}

function readContainerKeyWrap(value: unknown, label: string): ContainerKeyWrap {
  const record = readProjectionPlainRecord(value, label, registerShapeError);
  const recipientKind = readProjectionValue(record, "recipientKind");
  if (!isKekRecipientKind(recipientKind)) {
    throw registerShapeError(`${label}.recipientKind is invalid`);
  }

  return {
    containerKeyEpochId: readProjectionString(
      record,
      "containerKeyEpochId",
      label,
      registerShapeError,
    ),
    recipientKind,
    recipientId: readProjectionString(
      record,
      "recipientId",
      label,
      registerShapeError,
    ),
    recipientKeyEpochId: readProjectionString(
      record,
      "recipientKeyEpochId",
      label,
      registerShapeError,
    ),
    recipientKeyFingerprint: readProjectionString(
      record,
      "recipientKeyFingerprint",
      label,
      registerShapeError,
    ),
    kemCipherText: readProjectionString(
      record,
      "kemCipherText",
      label,
      registerShapeError,
    ),
    wrappedKey: readProjectionString(
      record,
      "wrappedKey",
      label,
      registerShapeError,
    ),
    wrapManifestHash: readProjectionString(
      record,
      "wrapManifestHash",
      label,
      registerShapeError,
    ),
  };
}

function readContainerKeyWraps(
  value: unknown,
  label: string,
): ContainerKeyWrap[] {
  if (!Array.isArray(value)) {
    throw registerShapeError(`${label} is invalid`);
  }

  return value.map((entry, index) =>
    readContainerKeyWrap(entry, `${label}[${index}]`),
  );
}

async function storeInitialRootContainer(
  tx: DatabaseTransaction,
  input: RegistrationRequest,
  fingerprint: string,
): Promise<{
  metadataAccessEpoch: number;
  metadataAccessStateHash: string;
  metadataDocumentId: string;
}> {
  const request = input.initialRootContainer;
  const metadataDocumentId = readInitialRootContainerMetadataDocumentId(input);
  const principalPolicies = principalPoliciesFromRequest(request);
  await assertPrincipalPoliciesCurrent(tx, principalPolicies);

  const event = requireRootVerification(
    await verifySignedAccessEvent({
      body: request.body as Parameters<
        typeof verifySignedAccessEvent
      >[0]["body"],
      event: readProjectionAccessEvent(
        request.event,
        "Initial root container event",
        registerShapeError,
      ),
      signerPublicKey: new Uint8Array(input.signingPublicKey),
    }),
  );

  assertInitialRootEventMatchesRegistration({
    event,
    fingerprint,
    registration: input,
  });

  const manifest = requireRootVerification(
    await verifyContainerAccessManifest({
      event,
      expectedManifestHash: request.expectedManifestHash,
      manifest: readProjectionAccessManifest(
        request.manifest,
        "Initial root container manifest",
        registerShapeError,
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
    throw new RegistrationError(
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
    { verifiedState: kekState },
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
  input: RegistrationRequest,
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

function readInitialRootMetadataDocumentId(input: RegistrationRequest): string {
  const event = input.initialRootMetadataDocument.event;
  const documentId = Reflect.get(event, "objectId");

  return typeof documentId === "string" && documentId.length > 0
    ? documentId
    : "";
}

async function createInitialRootMetadataDocument(
  tx: DatabaseTransaction,
  input: RegistrationRequest,
  fingerprint: string,
  rootMetadata: {
    metadataDocumentId: string;
  },
) {
  const requestDocumentId = readInitialRootMetadataDocumentId(input);
  if (requestDocumentId !== rootMetadata.metadataDocumentId) {
    throw new RegistrationError(
      "Initial root metadata document does not match root container metadata",
      400,
    );
  }

  const created = await createDocumentWithExecutor({
    executor: tx,
    fingerprint,
    request: input.initialRootMetadataDocument,
    userId: input.userId,
  });
  if (created.id !== rootMetadata.metadataDocumentId) {
    throw new RegistrationError(
      "Initial root metadata response does not match root container metadata",
      400,
    );
  }

  await tx.insert(containerMetadataDocuments).values({
    containerId: input.rootContainerId,
    documentId: created.id,
  });

  return created;
}

async function runRegistrationTransaction(
  db: ApiDatabase,
  input: RegistrationRequest,
  fingerprint: string,
  encapsulationFingerprint: string,
  signingKeyBytes: Uint8Array,
  encapsulationKeyBytes: Uint8Array,
) {
  return db.transaction(async (tx) => {
    const org = await createPersonalOrganization(tx, {
      adminGroupId: input.initialAdminGroup.groupId,
      memberGroupId: input.initialMemberGroup.groupId,
      organizationId: input.organizationId,
    });
    const container = await createRootContainer(
      tx,
      input.rootContainerId,
      org.id,
    );
    const user = await createRegisteredUser(tx, {
      encapsulationFingerprint,
      encapsulationKeyBytes,
      fingerprint,
      organizationId: org.id,
      userId: input.userId,
      signingKeyBytes,
    });
    await createInitialAdminGroup(tx, input, org.id);
    await createInitialMemberGroup(tx, input, org.id);
    await storeInitialAdminGroupPolicy(tx, input);
    await storeInitialMemberGroupPolicy(tx, input);
    await storeInitialOrganizationPolicy(tx, input);
    await syncOrganizationRosterFromMemberReachability({
      disabledByUserId: null,
      executor: tx,
      memberGroupId: input.initialMemberGroup.groupId,
      organizationId: org.id,
    });
    const rootMetadata = await storeInitialRootContainer(
      tx,
      input,
      fingerprint,
    );
    await createInitialBuiltinGrants(tx, input, org.id);
    const rootMetadataDocument = await createInitialRootMetadataDocument(
      tx,
      input,
      fingerprint,
      rootMetadata,
    );

    return {
      userId: user.id,
      organizationId: org.id,
      rootContainerId: container.id,
      rootMetadataAccessEpoch: rootMetadata.metadataAccessEpoch,
      rootMetadataAccessStateHash: rootMetadata.metadataAccessStateHash,
      rootMetadataDocumentId: rootMetadata.metadataDocumentId,
      rootMetadataDocument,
    };
  });
}

function toRegisterPrincipalPolicyError(
  error: unknown,
): RegistrationError | null {
  if (!(error instanceof Error)) {
    return null;
  }

  if (
    error.message === "Invalid principal state signature" ||
    error.message.startsWith("Principal state ") ||
    error.message.startsWith("Principal member envelope") ||
    error.message.startsWith("Principal member envelopes") ||
    error.message === "Principal epoch key conflict"
  ) {
    return new RegistrationError(error.message, 400);
  }

  if (error instanceof DocumentMutationError) {
    return new RegistrationError(error.message, error.status);
  }

  if (error instanceof ContainerMutationError) {
    return new RegistrationError(error.message, error.status);
  }

  return null;
}

export async function runRegistrationWorkflow(
  db: ApiDatabase,
  input: RegistrationRequest,
  keyMaterial: {
    readonly encapsulationFingerprint: string;
    readonly encapsulationKeyBytes: Uint8Array;
    readonly fingerprint: string;
    readonly signingKeyBytes: Uint8Array;
  },
) {
  validateInitialOrganizationPolicyInput(
    input,
    keyMaterial.fingerprint,
    keyMaterial.encapsulationFingerprint,
  );
  validateInitialAdminGroupInput(
    input,
    keyMaterial.fingerprint,
    keyMaterial.encapsulationFingerprint,
  );
  validateInitialMemberGroupInput(
    input,
    keyMaterial.fingerprint,
    keyMaterial.encapsulationFingerprint,
  );
  let result: Awaited<ReturnType<typeof runRegistrationTransaction>>;
  try {
    result = await runRegistrationTransaction(
      db,
      input,
      keyMaterial.fingerprint,
      keyMaterial.encapsulationFingerprint,
      keyMaterial.signingKeyBytes,
      keyMaterial.encapsulationKeyBytes,
    );
  } catch (error) {
    const registerPrincipalPolicyError = toRegisterPrincipalPolicyError(error);
    if (registerPrincipalPolicyError) {
      throw registerPrincipalPolicyError;
    }
    throw error;
  }
  return result;
}

export function isDuplicateRegistrationFingerprintError(
  error: unknown,
): boolean {
  return (
    error instanceof Error && error.message === DUPLICATE_FINGERPRINT_ERROR
  );
}
