import {
  buildPrincipalStateSigningInput,
  computePrincipalStateHash,
  generateKemSeedAndKeyPair,
  signPrincipalState,
  toFingerprint,
  wrapDekForRecipients,
} from "@tearleads/crypto";
import { bytesToBase64 } from "@tearleads/encoding";
import type { RegistrationRequest } from "@tearleads/validators/request";
import { routeApp } from "../../../src/routeApp";
import {
  createInitialAdminGroupRequest,
  createInitialMemberGroupRequest,
  createRegistrationBootstrap,
} from "../registration";

async function createInitialOrganizationPolicy(input: {
  adminGroupId: string;
  encapsulationPublicKey: Uint8Array;
  groupHeads: readonly {
    readonly keyEpoch: number;
    readonly keyFingerprint: string;
    readonly principalId: string;
    readonly principalType: "group";
    readonly stateHash: string;
    readonly version: number;
  }[];
  memberGroupId: string;
  organizationId: string;
  signingPrivateKey: Uint8Array;
  signingPublicKey: Uint8Array;
  userId: string;
}): Promise<RegistrationRequest["initialOrganizationPolicy"]> {
  const organizationKem = generateKemSeedAndKeyPair();
  const projection = [
    {
      userId: input.userId,
      role: "admin" as const,
    },
  ];
  const payloadCiphertext = bytesToBase64(
    new TextEncoder().encode(
      JSON.stringify({
        version: 2,
        organizationId: input.organizationId,
        adminGroupId: input.adminGroupId,
        memberGroupId: input.memberGroupId,
        groupHeads: input.groupHeads,
      }),
    ),
  );
  const [memberEnvelope] = await wrapDekForRecipients(
    organizationKem.secretKey,
    [input.encapsulationPublicKey],
  );

  if (!memberEnvelope) {
    throw new Error("Failed to wrap organization key for test user");
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
      principalType: "organization",
      principalId: input.organizationId,
      version: 1,
      prevStateHash: null,
      keyEpoch: 1,
      encapsulationPublicKey: bytesToBase64(organizationKem.publicKey),
      keyFingerprint: await toFingerprint(organizationKem.publicKey),
      members: [{ userId: input.userId }],
      memberEnvelopes,
      projection,
      grants: [],
      payloadCiphertext,
      externalAuthority: null,
      signedAt: new Date("2026-04-07T00:00:00.000Z").toISOString(),
      signerUserId: input.userId,
      signerUserKeyFingerprint: await toFingerprint(input.signingPublicKey),
    }),
    input.signingPrivateKey,
  );

  return {
    state,
    encryptedPayload: {
      cipherSuite: "aes-256-gcm",
      ciphertext: payloadCiphertext,
      ciphertextHash: state.payloadCiphertextHash,
    },
    projection,
    grants: [],
    memberEnvelopes,
  };
}

export async function submitRegistration(
  signingPublicKey: Uint8Array,
  signingPrivateKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
): Promise<Response> {
  return routeApp.request("/auth/register", {
    method: "POST",
    headers: {
      "cf-connecting-ip": "198.51.100.10",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(
      await createRegistrationRequestBody(
        signingPublicKey,
        signingPrivateKey,
        encapsulationPublicKey,
      ),
    ),
  });
}

export async function createRegistrationRequestBody(
  signingPublicKey: Uint8Array,
  signingPrivateKey: Uint8Array,
  encapsulationPublicKey: Uint8Array,
  options: {
    userId?: string | undefined;
    organizationId?: string | undefined;
    rootContainerId?: string | undefined;
    includeOrganizationProfileDocument?: boolean | undefined;
    includeRosterProfileDocument?: boolean | undefined;
    includeTrashSystemContainer?: boolean | undefined;
  } = {},
): Promise<RegistrationRequest> {
  const userId = options.userId ?? crypto.randomUUID();
  const organizationId = options.organizationId ?? crypto.randomUUID();
  const rootContainerId = options.rootContainerId ?? crypto.randomUUID();
  const organizationMetadataContainerId =
    options.includeOrganizationProfileDocument
      ? crypto.randomUUID()
      : undefined;
  const initialAdminGroup = await createInitialAdminGroupRequest({
    encapsulationPublicKey,
    grants: [{ containerId: rootContainerId, accessLevel: "admin" }],
    signingPrivateKey,
    signingPublicKey,
    userId,
  });
  const initialMemberGroup = await createInitialMemberGroupRequest({
    encapsulationPublicKey,
    grants: organizationMetadataContainerId
      ? [
          {
            containerId: organizationMetadataContainerId,
            accessLevel: "read",
          },
        ]
      : [],
    signingPrivateKey,
    signingPublicKey,
    userId,
  });
  const rootBootstrap = await createRegistrationBootstrap({
    adminGroup: initialAdminGroup,
    encapsulationPublicKey,
    memberGroup: initialMemberGroup,
    organizationId,
    organizationMetadataContainerId,
    includeTrashSystemContainer: options.includeTrashSystemContainer,
    ...(options.includeRosterProfileDocument
      ? { rosterProfileDocumentId: crypto.randomUUID() }
      : {}),
    ...(options.includeOrganizationProfileDocument
      ? { organizationProfileDocumentId: crypto.randomUUID() }
      : {}),
    rootContainerId,
    signingPrivateKey,
    signingPublicKey,
    userId,
  });

  return {
    userId,
    organizationId,
    rootContainerId,
    signingPublicKey: Array.from(signingPublicKey),
    encapsulationPublicKey: Array.from(encapsulationPublicKey),
    initialAdminGroup,
    initialMemberGroup,
    initialOrganizationPolicy: await createInitialOrganizationPolicy({
      adminGroupId: initialAdminGroup.groupId,
      encapsulationPublicKey,
      groupHeads: await Promise.all(
        [initialAdminGroup, initialMemberGroup]
          .sort((left, right) => left.groupId.localeCompare(right.groupId))
          .map(async (group) => ({
            principalType: "group" as const,
            principalId: group.groupId,
            version: group.initialGroupPolicy.state.version,
            keyEpoch: group.initialGroupPolicy.state.keyEpoch,
            stateHash: await computePrincipalStateHash(
              group.initialGroupPolicy.state,
            ),
            keyFingerprint: group.initialGroupPolicy.state.keyFingerprint,
          })),
      ),
      memberGroupId: initialMemberGroup.groupId,
      organizationId,
      signingPrivateKey,
      signingPublicKey,
      userId,
    }),
    initialRootContainer: rootBootstrap.initialRootContainer,
    initialRootMetadataDocument: rootBootstrap.initialRootMetadataDocument,
    ...(rootBootstrap.initialSystemContainers
      ? { initialSystemContainers: rootBootstrap.initialSystemContainers }
      : {}),
    ...(rootBootstrap.initialRosterProfileContainer
      ? {
          initialRosterProfileContainer:
            rootBootstrap.initialRosterProfileContainer,
        }
      : {}),
    ...(rootBootstrap.initialRosterProfileDocument
      ? {
          initialRosterProfileDocument:
            rootBootstrap.initialRosterProfileDocument,
        }
      : {}),
    ...(rootBootstrap.initialOrganizationMetadataContainer
      ? {
          initialOrganizationMetadataContainer:
            rootBootstrap.initialOrganizationMetadataContainer,
        }
      : {}),
    ...(rootBootstrap.initialOrganizationProfileDocument
      ? {
          initialOrganizationProfileDocument:
            rootBootstrap.initialOrganizationProfileDocument,
        }
      : {}),
  };
}
