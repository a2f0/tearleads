import {
  type AccessEvent,
  type AccessEventType,
  type AccessManifest,
  type AccessObjectKind,
  buildPrincipalStateSigningInput,
  type ContainerAccessManifestState,
  type ContainerCreateAccessEventBody,
  type ContainerGrantPrincipalHead,
  type ContainerKekRecipientTarget,
  type ContainerKeyEpoch,
  type ContainerKeyWrap,
  type ContainerUserRecipientKey,
  computeAccessEventBodyHash,
  computeAccessEventHash,
  computeAccessManifestHash,
  computeContainerKekMaterialId,
  computeContainerKekRecipientTargetHash,
  computeContainerKeyEpochHash,
  computeDocumentContentKeyTargetHash,
  computePrincipalStateHash,
  DOCUMENT_CONTENT_KEY_WRAP_SUITE,
  type DocumentContentKeyTarget,
  type DocumentLinkAccessEventBody,
  type DocumentLinkSetManifestState,
  deriveContainerAccessManifest,
  deriveDocumentLinkSetManifest,
  derivePrincipalRecipientKeyEpochId,
  encryptWithDek,
  generateKemSeedAndKeyPair,
  type PrincipalContainerGrant,
  signAccessEvent,
  signPrincipalState,
  toFingerprint,
  type UnsignedAccessEvent,
  wrapDekForRecipients,
} from "@symcrypt/crypto";
import { base64ToBytes, bytesToBase64 } from "@symcrypt/encoding";
import type {
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  DocumentCreateRequest,
  ProvisionedDocumentRequest,
  ProvisionedSystemContainerRequest,
} from "@symcrypt/validators/request";
import type { ContainerWriterProjectionResponse } from "@symcrypt/validators/response";
import {
  createOptionalProvisionedDocumentFixture,
  createProvisionedDocumentFixture,
  createProvisionedMetadataContainerFixture,
  createProvisionedTrashFixture,
  deriveOrganizationMetadataContainerSystemSlot,
  deriveRosterProfileContainerSystemSlot,
} from "./provisionedSystemContainer";
import { rootContainerProjectionFromArtifacts } from "./registrationRootProjection";
import { toWireJson, toWireRecord, toWireRecords } from "./registrationWire";

const REGISTER_SIGNED_AT = "2026-04-07T00:00:00.000Z";

interface RegistrationBootstrapInput {
  adminGroup?: CreateOrganizationGroupRequest | undefined;
  encapsulationPublicKey: Uint8Array;
  includeTrashSystemContainer?: boolean | undefined;
  // Gives org metadata a Members read grant.
  memberGroup?: CreateOrganizationGroupRequest | undefined;
  organizationId: string;
  organizationMetadataContainerId?: string | undefined;
  organizationProfileDocumentId?: string | undefined;
  rosterProfileDocumentId?: string | undefined;
  rootContainerId: string;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}

interface RegistrationBootstrap {
  initialRosterProfileContainer?: ProvisionedSystemContainerRequest | undefined;
  initialRosterProfileDocument?: ProvisionedDocumentRequest | undefined;
  initialOrganizationMetadataContainer?:
    | ProvisionedSystemContainerRequest
    | undefined;
  initialOrganizationProfileDocument?: ProvisionedDocumentRequest | undefined;
  initialRootContainer: ContainerMutationRequest;
  initialRootMetadataDocument: ProvisionedDocumentRequest;
  initialSystemContainers?: ProvisionedSystemContainerRequest[] | undefined;
  rootMetadataDocumentId: string;
}

interface SignedRegistrationEventInput {
  body: ContainerCreateAccessEventBody | DocumentLinkAccessEventBody;
  dependencyManifestHashes?: readonly string[];
  eventType: AccessEventType;
  objectId: string;
  objectKind: AccessObjectKind;
  organizationId: string;
  previousManifestHash: string | null;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signerPrivateKey: Uint8Array;
  signerUserId: string;
}

interface RootContainerCreateArtifacts {
  body: ContainerCreateAccessEventBody;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyEpochHash: string;
  keyTargetHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  metadataDocumentId: string;
  principalPolicies: Record<string, unknown>[];
  recipientTargets: ContainerKekRecipientTarget[];
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  userRecipientKeys: ContainerUserRecipientKey[];
  wraps: ContainerKeyWrap[];
}

interface ChildContainerCreateArtifacts {
  body: ContainerCreateAccessEventBody;
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  event: AccessEvent;
  eventHash: string;
  keyEpoch: ContainerKeyEpoch;
  keyEpochHash: string;
  keyTargetHash: string;
  manifest: AccessManifest;
  manifestHash: string;
  metadataDocumentId: string;
  recipientTargets: ContainerKekRecipientTarget[];
  request: ContainerMutationRequest;
  state: ContainerAccessManifestState;
  wraps: ContainerKeyWrap[];
}

function createSignerDeviceId(signingFingerprint: string): string {
  return `signing-key:${signingFingerprint}`;
}

function groupProjectionMember(userId: string) {
  return [
    {
      userId: userId,
      role: "admin" as const,
    },
  ];
}

export async function createInitialAdminGroupRequest(input: {
  encapsulationPublicKey: Uint8Array;
  grants?: readonly PrincipalContainerGrant[] | undefined;
  groupId?: string | undefined;
  name?: string | undefined;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}): Promise<CreateOrganizationGroupRequest> {
  const groupId = input.groupId ?? crypto.randomUUID();
  const groupKem = generateKemSeedAndKeyPair();
  const projection = groupProjectionMember(input.userId);
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
  const [memberEnvelope] = await wrapDekForRecipients(groupKem.secretKey, [
    input.encapsulationPublicKey,
  ]);

  if (!memberEnvelope) {
    throw new Error("Failed to wrap admin group key for test user");
  }

  const memberEnvelopes = [
    {
      userId: input.userId,
      memberKeyFingerprint: await toFingerprint(input.encapsulationPublicKey),
      kemCipherText: bytesToBase64(memberEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(memberEnvelope.wrappedKey),
    },
  ];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: groupId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
      keyFingerprint: await toFingerprint(groupKem.publicKey),
      members: [{ userId: input.userId }],
      memberEnvelopes,
      projection,
      grants: [...(input.grants ?? [])],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: REGISTER_SIGNED_AT,
      signerUserId: input.userId,
      signerUserKeyFingerprint: await toFingerprint(input.signingPublicKey),
    }),
    input.signingPrivateKey,
  );

  return {
    groupId,
    name: input.name ?? "Admins",
    initialGroupPolicy: {
      state,
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: payloadCiphertext,
        ciphertextHash: state.payloadCiphertextHash,
      },
      projection,
      grants: [...(input.grants ?? [])],
      memberEnvelopes,
    },
  };
}

export async function createInitialMemberGroupRequest(input: {
  encapsulationPublicKey: Uint8Array;
  grants?: readonly PrincipalContainerGrant[] | undefined;
  groupId?: string | undefined;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}): Promise<CreateOrganizationGroupRequest> {
  const groupId = input.groupId ?? crypto.randomUUID();
  const groupKem = generateKemSeedAndKeyPair();
  // Members holds the registering user alone; the Admins group is no longer a
  // nested member.
  const projection = [
    {
      userId: input.userId,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(JSON.stringify({ members: projection })),
  );
  const [userEnvelope] = await wrapDekForRecipients(groupKem.secretKey, [
    input.encapsulationPublicKey,
  ]);
  if (!userEnvelope) {
    throw new Error("Failed to wrap member group key for test user");
  }

  const memberEnvelopes = [
    {
      userId: input.userId,
      memberKeyFingerprint: await toFingerprint(input.encapsulationPublicKey),
      kemCipherText: bytesToBase64(userEnvelope.kemCipherText),
      wrappedKey: bytesToBase64(userEnvelope.wrappedKey),
    },
  ];
  const state = await signPrincipalState(
    await buildPrincipalStateSigningInput({
      principalType: "group",
      principalId: groupId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(groupKem.publicKey),
      keyFingerprint: await toFingerprint(groupKem.publicKey),
      members: [{ userId: input.userId }],
      memberEnvelopes,
      projection,
      grants: [...(input.grants ?? [])],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: REGISTER_SIGNED_AT,
      signerUserId: input.userId,
      signerUserKeyFingerprint: await toFingerprint(input.signingPublicKey),
    }),
    input.signingPrivateKey,
  );

  return {
    groupId,
    name: "Members",
    initialGroupPolicy: {
      state,
      encryptedPayload: {
        cipherSuite: "aes-256-gcm",
        ciphertext: payloadCiphertext,
        ciphertextHash: state.payloadCiphertextHash,
      },
      projection,
      grants: [...(input.grants ?? [])],
      memberEnvelopes,
    },
  };
}

async function signRegistrationEvent(
  input: SignedRegistrationEventInput,
): Promise<{ event: AccessEvent; eventHash: string }> {
  const unsigned: UnsignedAccessEvent = {
    version: 1,
    eventId: crypto.randomUUID(),
    eventType: input.eventType,
    objectKind: input.objectKind,
    objectId: input.objectId,
    organizationId: input.organizationId,
    previousManifestHash: input.previousManifestHash,
    dependencyManifestHashes: [...(input.dependencyManifestHashes ?? [])],
    bodyHash: await computeAccessEventBodyHash(
      toWireJson(input.body, `${input.eventType} event body`),
    ),
    signerUserId: input.signerUserId,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signedAt: REGISTER_SIGNED_AT,
  };
  const event = await signAccessEvent(unsigned, input.signerPrivateKey);

  return {
    event,
    eventHash: await computeAccessEventHash(event),
  };
}

async function principalHeadFromInitialGroupPolicy(input: {
  adminGroup: CreateOrganizationGroupRequest;
}): Promise<ContainerGrantPrincipalHead> {
  const { initialGroupPolicy } = input.adminGroup;

  return {
    principalType: "group",
    principalId: input.adminGroup.groupId,
    version: initialGroupPolicy.state.version,
    keyEpoch: initialGroupPolicy.state.keyEpoch,
    stateHash: await computePrincipalStateHash(initialGroupPolicy.state),
    keyFingerprint: initialGroupPolicy.state.keyFingerprint,
  };
}

async function principalPolicyRecordFromInitialGroupPolicy(input: {
  adminGroup: CreateOrganizationGroupRequest;
}): Promise<Record<string, unknown>> {
  const { initialGroupPolicy } = input.adminGroup;
  const head = await principalHeadFromInitialGroupPolicy(input);

  return toWireRecord(
    {
      principalType: head.principalType,
      principalId: head.principalId,
      version: head.version,
      keyEpoch: head.keyEpoch,
      stateHash: head.stateHash,
      state: {
        ...initialGroupPolicy.state,
        stateHash: head.stateHash,
      },
      projection: initialGroupPolicy.projection,
      grants: initialGroupPolicy.grants,
      checkpoint: {
        principalType: head.principalType,
        principalId: head.principalId,
        version: head.version,
        stateHash: head.stateHash,
      },
    },
    "initial admin group policy",
  );
}

async function wrapRootContainerKeyForUser(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  encapsulationPublicKey: Uint8Array;
  manifestHash: string;
  userId: string;
}): Promise<{
  recipientTarget: ContainerKekRecipientTarget;
  userRecipientKey: ContainerUserRecipientKey;
  wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    input.encapsulationPublicKey,
  ]);
  if (!recipient) {
    throw new Error("Failed to wrap root container key for test user");
  }

  const userRecipientKey: ContainerUserRecipientKey = {
    userId: input.userId,
    recipientKeyEpochId: `user:${input.userId}:encapsulation:${recipient.keyFingerprint}`,
    recipientKeyFingerprint: recipient.keyFingerprint,
  };
  const recipientTarget: ContainerKekRecipientTarget = {
    recipientKind: "user",
    recipientId: input.userId,
    recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
    recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
  };

  return {
    recipientTarget,
    userRecipientKey,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: "user",
      recipientId: input.userId,
      recipientKeyEpochId: userRecipientKey.recipientKeyEpochId,
      recipientKeyFingerprint: userRecipientKey.recipientKeyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}

async function wrapRootContainerKeyForManagedPrincipal(input: {
  containerKey: Uint8Array;
  containerKeyEpochId: string;
  manifestHash: string;
  principalEncapsulationPublicKey: string;
  principalHead: ContainerGrantPrincipalHead;
}): Promise<{
  recipientTarget: ContainerKekRecipientTarget;
  wrap: ContainerKeyWrap;
}> {
  const [recipient] = await wrapDekForRecipients(input.containerKey, [
    base64ToBytes(input.principalEncapsulationPublicKey),
  ]);
  if (!recipient) {
    throw new Error("Failed to wrap root container key for admin group");
  }

  const recipientTarget: ContainerKekRecipientTarget = {
    recipientKind: input.principalHead.principalType,
    recipientId: input.principalHead.principalId,
    recipientKeyEpochId: derivePrincipalRecipientKeyEpochId(
      input.principalHead,
    ),
    recipientKeyFingerprint: input.principalHead.keyFingerprint,
  };

  return {
    recipientTarget,
    wrap: {
      containerKeyEpochId: input.containerKeyEpochId,
      recipientKind: recipientTarget.recipientKind,
      recipientId: recipientTarget.recipientId,
      recipientKeyEpochId: recipientTarget.recipientKeyEpochId,
      recipientKeyFingerprint: recipientTarget.recipientKeyFingerprint,
      kemCipherText: bytesToBase64(recipient.kemCipherText),
      wrappedKey: bytesToBase64(recipient.wrappedKey),
      wrapManifestHash: input.manifestHash,
    },
  };
}

async function createRootContainerArtifacts(input: {
  adminGroup?: CreateOrganizationGroupRequest | undefined;
  encapsulationPublicKey: Uint8Array;
  organizationId: string;
  rootContainerId: string;
  rootMetadataDocumentId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<RootContainerCreateArtifacts> {
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId: input.rootContainerId,
    keyEpoch: 1,
    keyMaterial: containerKey,
  });
  const adminPrincipalHead = input.adminGroup
    ? await principalHeadFromInitialGroupPolicy({
        adminGroup: input.adminGroup,
      })
    : null;
  const principalPolicies = input.adminGroup
    ? [
        await principalPolicyRecordFromInitialGroupPolicy({
          adminGroup: input.adminGroup,
        }),
      ]
    : [];
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.rootMetadataDocumentId,
    containerKeyEpochId,
    directGrants: [
      {
        accessLevel: "admin",
        subjectId: adminPrincipalHead?.principalId ?? input.userId,
        subjectType: adminPrincipalHead?.principalType ?? "user",
      },
    ],
    referencedPrincipalHeads: adminPrincipalHead ? [adminPrincipalHead] : [],
  };
  const { event, eventHash } = await signRegistrationEvent({
    body,
    eventType: "container.create",
    objectKind: "container",
    objectId: input.rootContainerId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signingPrivateKey,
    signerUserId: input.userId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId: input.rootContainerId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: null,
    parentManifestHash: null,
    metadataDocumentId: input.rootMetadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId: input.rootContainerId,
    keyEpoch: 1,
    accessManifestHash: manifestHash,
    parentContainerKeyEpochId: null,
    createdByEventHash: eventHash,
    createdByManifestHash: manifestHash,
  };
  const rootRecipient =
    adminPrincipalHead && input.adminGroup
      ? {
          ...(await wrapRootContainerKeyForManagedPrincipal({
            containerKey,
            containerKeyEpochId,
            manifestHash,
            principalEncapsulationPublicKey:
              input.adminGroup.initialGroupPolicy.state.encapsulationPublicKey,
            principalHead: adminPrincipalHead,
          })),
          userRecipientKey: null,
        }
      : await wrapRootContainerKeyForUser({
          containerKey,
          containerKeyEpochId,
          encapsulationPublicKey: input.encapsulationPublicKey,
          manifestHash,
          userId: input.userId,
        });
  const { recipientTarget, userRecipientKey, wrap } = rootRecipient;
  const recipientTargets = [recipientTarget];
  const userRecipientKeys = userRecipientKey ? [userRecipientKey] : [];
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);

  return {
    body,
    containerKey,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: input.rootMetadataDocumentId,
    principalPolicies,
    recipientTargets,
    request: {
      event: toWireRecord(event, "root container request event"),
      body: toWireRecord(body, "root container request body"),
      expectedManifestHash: manifestHash,
      manifest: toWireRecord(manifest, "root container request manifest"),
      previousManifest: null,
      parentContainerPath: [],
      principalPolicies,
      keyEpoch: toWireRecord(keyEpoch, "root container request key epoch"),
      predecessorBridge: null,
      keyring: null,
      wraps: toWireRecords([wrap], "root container request wraps"),
      userRecipientKeys: toWireRecords(
        userRecipientKeys,
        "root container request user recipient keys",
      ),
    },
    state,
    userRecipientKeys,
    wraps: [wrap],
  };
}

async function createChildContainerArtifacts(input: {
  metadataDocumentId: string;
  managedGrant?:
    | { accessLevel: "read"; group: CreateOrganizationGroupRequest }
    | undefined;
  parent: RootContainerCreateArtifacts;
  parentProjection: ContainerWriterProjectionResponse;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<ChildContainerCreateArtifacts> {
  const parentKek = input.parentProjection.containerKeks.at(-1);
  if (!parentKek) {
    throw new Error("Missing parent container KEK for child fixture");
  }

  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerId = input.metadataDocumentId;
  const containerKeyEpochId = await computeContainerKekMaterialId({
    containerId,
    keyEpoch: 1,
    keyMaterial: containerKey,
  });
  const managedGrant = input.managedGrant;
  const managedHead = managedGrant
    ? await principalHeadFromInitialGroupPolicy({
        adminGroup: managedGrant.group,
      })
    : null;
  const body: ContainerCreateAccessEventBody = {
    eventType: "container.create",
    parentContainerId: input.parent.state.containerId,
    parentManifestHash: input.parent.manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants:
      managedGrant && managedHead
        ? [
            {
              accessLevel: managedGrant.accessLevel,
              subjectId: managedHead.principalId,
              subjectType: managedHead.principalType,
            },
          ]
        : [],
    referencedPrincipalHeads: managedHead ? [managedHead] : [],
  };
  const { event, eventHash } = await signRegistrationEvent({
    body,
    dependencyManifestHashes: input.parentProjection.path.map(
      (bundle) => bundle.manifestHash,
    ),
    eventType: "container.create",
    objectKind: "container",
    objectId: containerId,
    organizationId: input.parent.state.organizationId,
    previousManifestHash: null,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signingPrivateKey,
    signerUserId: input.userId,
  });
  const state: ContainerAccessManifestState = {
    version: 1,
    containerId,
    organizationId: input.parent.state.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    parentContainerId: input.parent.state.containerId,
    parentManifestHash: input.parent.manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    containerKeyEpochId,
    directGrants: body.directGrants,
    referencedPrincipalHeads: body.referencedPrincipalHeads,
  };
  const manifest = await deriveContainerAccessManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const keyEpoch: ContainerKeyEpoch = {
    id: containerKeyEpochId,
    containerId,
    keyEpoch: 1,
    accessManifestHash: manifestHash,
    parentContainerKeyEpochId: parentKek.containerKeyEpochId,
    createdByEventHash: eventHash,
    createdByManifestHash: manifestHash,
  };
  const parentTarget: ContainerKekRecipientTarget = {
    recipientKind: "container",
    recipientId: parentKek.containerId,
    recipientKeyEpochId: parentKek.containerKeyEpochId,
    recipientKeyFingerprint: parentKek.keyEpochHash,
  };
  const wrappedContainerKey = await encryptWithDek(
    containerKey,
    input.parent.containerKey,
  );
  const parentWrap: ContainerKeyWrap = {
    containerKeyEpochId,
    recipientKind: "container",
    recipientId: parentKek.containerId,
    recipientKeyEpochId: parentKek.containerKeyEpochId,
    recipientKeyFingerprint: parentKek.keyEpochHash,
    kemCipherText: bytesToBase64(wrappedContainerKey.iv),
    wrappedKey: bytesToBase64(wrappedContainerKey.ciphertext),
    wrapManifestHash: manifestHash,
  };
  const managedRecipient =
    managedGrant && managedHead
      ? await wrapRootContainerKeyForManagedPrincipal({
          containerKey,
          containerKeyEpochId,
          manifestHash,
          principalEncapsulationPublicKey:
            managedGrant.group.initialGroupPolicy.state.encapsulationPublicKey,
          principalHead: managedHead,
        })
      : null;
  const recipientTargets: ContainerKekRecipientTarget[] = managedRecipient
    ? [parentTarget, managedRecipient.recipientTarget]
    : [parentTarget];
  const wraps: ContainerKeyWrap[] = managedRecipient
    ? [parentWrap, managedRecipient.wrap]
    : [parentWrap];
  const keyTargetHash =
    await computeContainerKekRecipientTargetHash(recipientTargets);
  const keyEpochHash = await computeContainerKeyEpochHash(keyEpoch);
  // The Members group policy justifies the group KEK recipient target; the
  // parent's Admins policy justifies writing under the root parent.
  const principalPolicies =
    managedGrant && managedHead
      ? [
          ...input.parent.principalPolicies,
          await principalPolicyRecordFromInitialGroupPolicy({
            adminGroup: managedGrant.group,
          }),
        ]
      : input.parent.principalPolicies;

  return {
    body,
    containerKey,
    containerKeyEpochId,
    event,
    eventHash,
    keyEpoch,
    keyEpochHash,
    keyTargetHash,
    manifest,
    manifestHash,
    metadataDocumentId: input.metadataDocumentId,
    recipientTargets,
    request: {
      event: toWireRecord(event, "child container request event"),
      body: toWireRecord(body, "child container request body"),
      expectedManifestHash: manifestHash,
      manifest: toWireRecord(manifest, "child container request manifest"),
      previousManifest: null,
      parentContainerPath: input.parentProjection.path,
      principalPolicies,
      keyEpoch: toWireRecord(keyEpoch, "child container request key epoch"),
      predecessorBridge: null,
      keyring: null,
      wraps: toWireRecords(wraps, "child container request wraps"),
      parentKekState: toWireRecord(parentKek, "child container parent KEK"),
      userRecipientKeys: [],
    },
    state,
    wraps,
  };
}

function childContainerProjectionFromArtifacts(input: {
  child: ChildContainerCreateArtifacts;
  parentProjection: ContainerWriterProjectionResponse;
}): ContainerWriterProjectionResponse {
  const parentKek = input.parentProjection.containerKeks.at(-1);
  if (!parentKek) {
    throw new Error(
      "Missing parent container KEK for child projection fixture",
    );
  }

  return {
    containerId: input.child.state.containerId,
    organizationId: input.child.state.organizationId,
    path: [
      ...input.parentProjection.path,
      {
        event: {
          event: toWireRecord(input.child.event, "child container event"),
          body: toWireRecord(input.child.body, "child container event body"),
          eventHash: input.child.eventHash,
        },
        manifest: toWireRecord(
          input.child.manifest,
          "child container manifest",
        ),
        manifestHash: input.child.manifestHash,
        state: toWireRecord(input.child.state, "child container state"),
      },
    ],
    containerKeks: [
      ...input.parentProjection.containerKeks,
      {
        containerId: input.child.state.containerId,
        accessManifestHash: input.child.manifestHash,
        containerKeyEpochId: input.child.containerKeyEpochId,
        containerKeyEpoch: input.child.keyEpoch.keyEpoch,
        keyEpoch: toWireRecord(
          input.child.keyEpoch,
          "child container key epoch",
        ),
        keyEpochHash: input.child.keyEpochHash,
        keyTargetHash: input.child.keyTargetHash,
        containerManifestHistory: [],
        keyring: null,
        parentContainerKeyEpochId: parentKek.containerKeyEpochId,
        recipientTargets: toWireRecords(
          input.child.recipientTargets,
          "child container recipient targets",
        ),
        wraps: toWireRecords(input.child.wraps, "child container wraps"),
      },
    ],
  };
}

async function createRootMetadataDocumentRequest(input: {
  containerKey: Uint8Array;
  containerProjection: ContainerWriterProjectionResponse;
  organizationId: string;
  rootMetadataDocumentId: string;
  signerDeviceId: string;
  signerKeyFingerprint: string;
  signingPrivateKey: Uint8Array;
  userId: string;
}): Promise<DocumentCreateRequest> {
  const targetContainerKek = input.containerProjection.containerKeks.at(-1);
  if (!targetContainerKek) {
    throw new Error("Missing root container KEK for metadata document fixture");
  }

  const target: DocumentContentKeyTarget = {
    containerId: targetContainerKek.containerId,
    containerManifestHash: targetContainerKek.accessManifestHash,
    containerKeyEpochId: targetContainerKek.containerKeyEpochId,
    containerKeyEpoch: targetContainerKek.containerKeyEpoch,
  };
  const body: DocumentLinkAccessEventBody = {
    eventType: "document.link",
    containerId: target.containerId,
    containerManifestHash: target.containerManifestHash,
  };
  const { event, eventHash } = await signRegistrationEvent({
    body,
    dependencyManifestHashes: [target.containerManifestHash],
    eventType: "document.link",
    objectKind: "document",
    objectId: input.rootMetadataDocumentId,
    organizationId: input.organizationId,
    previousManifestHash: null,
    signerDeviceId: input.signerDeviceId,
    signerKeyFingerprint: input.signerKeyFingerprint,
    signerPrivateKey: input.signingPrivateKey,
    signerUserId: input.userId,
  });
  const state: DocumentLinkSetManifestState = {
    version: 1,
    documentId: input.rootMetadataDocumentId,
    organizationId: input.organizationId,
    epoch: 1,
    previousManifestHash: null,
    eventHash,
    linkedContainerIds: [target.containerId],
  };
  const manifest = await deriveDocumentLinkSetManifest(state);
  const manifestHash = await computeAccessManifestHash(manifest);
  const targetHash = await computeDocumentContentKeyTargetHash([target]);
  const contentKey = crypto.getRandomValues(new Uint8Array(32));
  const wrappedContentKey = await encryptWithDek(
    contentKey,
    input.containerKey,
  );

  return {
    event: toWireRecord(event, "root metadata document request event"),
    body: toWireRecord(body, "root metadata document request body"),
    expectedManifestHash: manifestHash,
    manifest: toWireRecord(manifest, "root metadata document request manifest"),
    previousManifest: null,
    targetContainerPathRefs: input.containerProjection.path.map((bundle) => ({
      containerId: (bundle.state as { containerId: string }).containerId,
      manifestHash: bundle.manifestHash,
    })),
    contentKeyBundle: {
      contentKeyEpoch: 1,
      linkSetManifestHash: manifestHash,
      targetHash,
      targets: [
        {
          ...target,
          wrappedKey: bytesToBase64(wrappedContentKey.ciphertext),
          wrappingMetadata: {
            suite: DOCUMENT_CONTENT_KEY_WRAP_SUITE,
            iv: bytesToBase64(wrappedContentKey.iv),
          },
        },
      ],
    },
  };
}

export async function createRegistrationBootstrap(
  input: RegistrationBootstrapInput,
): Promise<RegistrationBootstrap> {
  const rootMetadataDocumentId = crypto.randomUUID();
  const signerKeyFingerprint = await toFingerprint(input.signingPublicKey);
  const signerDeviceId = createSignerDeviceId(signerKeyFingerprint);
  const documentAuthor = {
    organizationId: input.organizationId,
    signerDeviceId,
    signerKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
    userId: input.userId,
  };
  const rootContainer = await createRootContainerArtifacts({
    adminGroup: input.adminGroup,
    encapsulationPublicKey: input.encapsulationPublicKey,
    organizationId: input.organizationId,
    rootContainerId: input.rootContainerId,
    rootMetadataDocumentId,
    signerDeviceId,
    signerKeyFingerprint,
    signingPrivateKey: input.signingPrivateKey,
    userId: input.userId,
  });
  const rootContainerProjection =
    rootContainerProjectionFromArtifacts(rootContainer);
  const rootMetadataDocument = await createRootMetadataDocumentRequest({
    ...documentAuthor,
    containerKey: rootContainer.containerKey,
    containerProjection: rootContainerProjection,
    rootMetadataDocumentId,
  });
  const initialRootMetadataDocument = await createProvisionedDocumentFixture({
    ...documentAuthor,
    containerProjection: rootContainerProjection,
    document: rootMetadataDocument,
    documentId: rootMetadataDocumentId,
    fixtureLabel: "root-metadata",
    initialName: "/",
  });
  const trashContainer = input.includeTrashSystemContainer
    ? await createChildContainerArtifacts({
        metadataDocumentId: crypto.randomUUID(),
        parent: rootContainer,
        parentProjection: rootContainerProjection,
        signerDeviceId,
        signerKeyFingerprint,
        signingPrivateKey: input.signingPrivateKey,
        userId: input.userId,
      })
    : undefined;
  const trashContainerProjection = trashContainer
    ? childContainerProjectionFromArtifacts({
        child: trashContainer,
        parentProjection: rootContainerProjection,
      })
    : undefined;
  const trashMetadataDocument =
    trashContainer && trashContainerProjection
      ? await createRootMetadataDocumentRequest({
          ...documentAuthor,
          containerKey: trashContainer.containerKey,
          containerProjection: trashContainerProjection,
          rootMetadataDocumentId: trashContainer.metadataDocumentId,
        })
      : undefined;
  const trashSystemContainer =
    trashContainer && trashContainerProjection && trashMetadataDocument
      ? await createProvisionedTrashFixture({
          ...documentAuthor,
          container: trashContainer.request,
          containerProjection: trashContainerProjection,
          metadataDocument: trashMetadataDocument,
          metadataDocumentId: trashContainer.metadataDocumentId,
        })
      : undefined;
  const rosterProfileContainer = input.rosterProfileDocumentId
    ? await createChildContainerArtifacts({
        metadataDocumentId: crypto.randomUUID(),
        parent: rootContainer,
        parentProjection: rootContainerProjection,
        signerDeviceId,
        signerKeyFingerprint,
        signingPrivateKey: input.signingPrivateKey,
        userId: input.userId,
      })
    : undefined;
  const rosterProfileContainerProjection = rosterProfileContainer
    ? childContainerProjectionFromArtifacts({
        child: rosterProfileContainer,
        parentProjection: rootContainerProjection,
      })
    : undefined;
  const rosterProfileContainerMetadataDocument =
    rosterProfileContainer && rosterProfileContainerProjection
      ? await createRootMetadataDocumentRequest({
          ...documentAuthor,
          containerKey: rosterProfileContainer.containerKey,
          containerProjection: rosterProfileContainerProjection,
          rootMetadataDocumentId: rosterProfileContainer.metadataDocumentId,
        })
      : undefined;
  const initialRosterProfileContainer =
    rosterProfileContainer &&
    rosterProfileContainerProjection &&
    rosterProfileContainerMetadataDocument
      ? await createProvisionedMetadataContainerFixture({
          ...documentAuthor,
          container: rosterProfileContainer.request,
          containerProjection: rosterProfileContainerProjection,
          metadataDocument: rosterProfileContainerMetadataDocument,
          documentId: rosterProfileContainer.metadataDocumentId,
          fixtureLabel: "roster-profile-container-metadata",
          initialName: "Roster Profiles",
          systemSlot: await deriveRosterProfileContainerSystemSlot(
            input.organizationId,
          ),
        })
      : undefined;
  const rosterProfileDocument =
    input.rosterProfileDocumentId &&
    rosterProfileContainer &&
    rosterProfileContainerProjection
      ? await createRootMetadataDocumentRequest({
          ...documentAuthor,
          containerKey: rosterProfileContainer.containerKey,
          containerProjection: rosterProfileContainerProjection,
          rootMetadataDocumentId: input.rosterProfileDocumentId,
        })
      : undefined;
  const initialRosterProfileDocument =
    await createOptionalProvisionedDocumentFixture({
      ...documentAuthor,
      containerProjection: rosterProfileContainerProjection,
      document: rosterProfileDocument,
      documentId: input.rosterProfileDocumentId,
      fixtureLabel: "roster-profile",
      initialName: "You",
    });
  const organizationMetadataContainer = input.organizationProfileDocumentId
    ? await createChildContainerArtifacts({
        metadataDocumentId:
          input.organizationMetadataContainerId ?? crypto.randomUUID(),
        ...(input.memberGroup
          ? { managedGrant: { accessLevel: "read", group: input.memberGroup } }
          : {}),
        parent: rootContainer,
        parentProjection: rootContainerProjection,
        signerDeviceId,
        signerKeyFingerprint,
        signingPrivateKey: input.signingPrivateKey,
        userId: input.userId,
      })
    : undefined;
  const organizationMetadataContainerProjection = organizationMetadataContainer
    ? childContainerProjectionFromArtifacts({
        child: organizationMetadataContainer,
        parentProjection: rootContainerProjection,
      })
    : undefined;
  const organizationMetadataContainerDocument =
    organizationMetadataContainer && organizationMetadataContainerProjection
      ? await createRootMetadataDocumentRequest({
          ...documentAuthor,
          containerKey: organizationMetadataContainer.containerKey,
          containerProjection: organizationMetadataContainerProjection,
          rootMetadataDocumentId:
            organizationMetadataContainer.metadataDocumentId,
        })
      : undefined;
  const initialOrganizationMetadataContainer =
    organizationMetadataContainer &&
    organizationMetadataContainerProjection &&
    organizationMetadataContainerDocument
      ? await createProvisionedMetadataContainerFixture({
          ...documentAuthor,
          container: organizationMetadataContainer.request,
          containerProjection: organizationMetadataContainerProjection,
          metadataDocument: organizationMetadataContainerDocument,
          documentId: organizationMetadataContainer.metadataDocumentId,
          fixtureLabel: "organization-metadata-container",
          initialName: "Organization Metadata",
          systemSlot: await deriveOrganizationMetadataContainerSystemSlot(
            input.organizationId,
          ),
        })
      : undefined;
  const organizationProfileDocument =
    input.organizationProfileDocumentId &&
    organizationMetadataContainer &&
    organizationMetadataContainerProjection
      ? await createRootMetadataDocumentRequest({
          ...documentAuthor,
          containerKey: organizationMetadataContainer.containerKey,
          containerProjection: organizationMetadataContainerProjection,
          rootMetadataDocumentId: input.organizationProfileDocumentId,
        })
      : undefined;
  const initialOrganizationProfileDocument =
    await createOptionalProvisionedDocumentFixture({
      ...documentAuthor,
      containerProjection: organizationMetadataContainerProjection,
      document: organizationProfileDocument,
      documentId: input.organizationProfileDocumentId,
      fixtureLabel: "organization-profile",
      initialName: "Personal Org",
    });

  return {
    ...(initialRosterProfileContainer ? { initialRosterProfileContainer } : {}),
    ...(initialRosterProfileDocument ? { initialRosterProfileDocument } : {}),
    ...(initialOrganizationMetadataContainer
      ? { initialOrganizationMetadataContainer }
      : {}),
    ...(initialOrganizationProfileDocument
      ? { initialOrganizationProfileDocument }
      : {}),
    initialRootContainer: rootContainer.request,
    initialRootMetadataDocument,
    ...(trashSystemContainer
      ? { initialSystemContainers: [trashSystemContainer] }
      : {}),
    rootMetadataDocumentId,
  };
}
