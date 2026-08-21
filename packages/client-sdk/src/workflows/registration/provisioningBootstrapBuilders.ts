import type { ContainerGrantPrincipalHead } from "@symcrypt/crypto";
import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type { CreateOrganizationGroupRequest } from "@symcrypt/validators/request";
import { createInitializedContainerMetadataDocument } from "../../data/containers/containerMetadataDocument";
import { deriveStableDocumentId } from "../../data/documents/shared/stableDocumentId";
import {
  type ContainerSystemSlotDefinition,
  deriveContainerSystemSlot,
} from "../container-contents/systemSlot";
import {
  buildContainerCreatePlan,
  childContainerWriterProjectionFromCreatePlan,
} from "../containers/child/create";
import {
  buildRootContainerCreatePlan,
  rootContainerWriterProjectionFromCreatePlan,
} from "../containers/root/create";
import type { resolveDocumentCreateAuthor } from "../documents/author";
import { buildMaterializedDocumentCreatePlan } from "../documents/create";
import { buildInitialDocumentSyncRequest } from "../documents/initialSync";
import { groupPolicyMutationHead } from "../organizations/groupPolicyMutationHead";
import { getOrganizationProfileDocumentLocalId } from "../organizations/organizationProfile";
import {
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationRosterProfileContainerSystemSlot,
  getRosterProfileDocumentLocalId,
  ORGANIZATION_METADATA_CONTAINER_NAME,
  ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
} from "../organizations/rosterProfileContainer";
import type {
  InitialOrganizationMetadataBootstrap,
  InitialRootContainerCreatePlan,
  InitialRosterProfileBootstrap,
  InitialSystemContainerBootstrap,
  InitialSystemContainerCreatePlan,
} from "./organizationProvisioningArtifacts";
import {
  buildProvisionedOrganizationProfile,
  buildProvisionedRosterProfile,
} from "./provisionedProfileDocument";
import { verifiedPrincipalPolicyFromInitialGroupRequest } from "./registrationPrincipalPolicyPersistence";
import type { createInitialRootMetadataBootstrap } from "./rootMetadataBootstrap";

type InitialRootContainerProjection = ReturnType<
  typeof rootContainerWriterProjectionFromCreatePlan
>;

/**
 * An app-owned system container to provision atomically with a new organization
 * (e.g. a trash bin). The client-sdk is agnostic to what these are:
 * the caller (the app, which owns the mini-app slot namespaces) declares each
 * one, and the provisioning path derives its per-user system slot, builds a
 * signed Admins-scoped child of root, and links it into the same transaction as
 * the rest of the organization bootstrap. The behavioral rules that govern a
 * system container are resolved client-side by slot, so provisioning needs only
 * the slot definition, display name, and icon — no rules travel to the server.
 */
export interface ProvisionedSystemContainerSpec {
  readonly slotDefinition: ContainerSystemSlotDefinition;
  readonly name: string;
  readonly icon: string | null;
}

interface InitialOrganizationMetadataBootstrapInput {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  containerId: string;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  organizationProfileName?: string | undefined;
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  targetSecretKey: Uint8Array;
}

interface InitialRosterProfileInput {
  author: InitialOrganizationMetadataBootstrapInput["author"];
  containerProjection: ReturnType<
    typeof childContainerWriterProjectionFromCreatePlan
  >;
  encapsulationPublicKey: Uint8Array;
  knownContainerKeks: ReadonlyMap<string, Uint8Array>;
  rosterProfileNickname?: string | undefined;
  targetSecretKey: Uint8Array;
}

interface ProvisionedChildContainerCore {
  containerId: string;
  containerMetadataDocument: Awaited<
    ReturnType<typeof buildMaterializedDocumentCreatePlan>
  >;
  containerMetadataInitialUpdate: Uint8Array;
  containerPlan: InitialSystemContainerCreatePlan;
  containerProjection: ReturnType<
    typeof childContainerWriterProjectionFromCreatePlan
  >;
  containerRequest: {
    systemSlot: ContainerSystemSlot;
    container: InitialSystemContainerCreatePlan["plan"]["request"];
    initialMetadataSync: Awaited<
      ReturnType<typeof buildInitialDocumentSyncRequest>
    >;
    metadataDocument: Awaited<
      ReturnType<typeof buildMaterializedDocumentCreatePlan>
    >["plan"]["request"];
  };
  knownContainerKeks: ReadonlyMap<string, Uint8Array>;
  systemSlot: ContainerSystemSlot;
}

/**
 * The shared spine of every provisioned system child container: mint the
 * container and its metadata document under root, project the writer view,
 * and assemble the create request. Callers differ only in slot derivation,
 * display metadata, authorizing policies, an optional managed read grant, and
 * what they attach afterwards (roster/org profile documents).
 */
async function buildProvisionedChildContainerCore(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  containerId?: string | undefined;
  icon: string | null;
  managedPrincipalGrant?: Parameters<
    typeof buildContainerCreatePlan
  >[0]["managedPrincipalGrant"];
  name: string;
  principalPolicies: Parameters<
    typeof buildContainerCreatePlan
  >[0]["principalPolicies"];
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  systemSlot: ContainerSystemSlot;
  targetSecretKey: Uint8Array;
}): Promise<ProvisionedChildContainerCore> {
  const containerId = input.containerId ?? crypto.randomUUID();
  const { initialUpdate } = await createInitializedContainerMetadataDocument(
    containerId,
    {
      icon: input.icon,
      name: input.name,
    },
  );
  const containerKey = crypto.getRandomValues(new Uint8Array(32));
  const containerPlan: InitialSystemContainerCreatePlan = {
    containerKey,
    plan: await buildContainerCreatePlan({
      author: input.author,
      containerId,
      containerKey,
      ...(input.managedPrincipalGrant
        ? { managedPrincipalGrant: input.managedPrincipalGrant }
        : {}),
      metadataDocumentId: containerId,
      parentKekMaterial: input.rootContainer.containerKey,
      parentProjection: input.rootContainerProjection,
      principalPolicies: input.principalPolicies,
    }),
  };
  const containerProjection = childContainerWriterProjectionFromCreatePlan({
    materializedPlan: containerPlan,
    parentProjection: input.rootContainerProjection,
  });
  const knownContainerKeks = new Map([
    [containerPlan.plan.containerKeyEpochId, containerPlan.containerKey],
  ]);
  const containerMetadataDocument = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection,
    documentId: containerPlan.plan.metadataDocumentId,
    knownContainerKeks,
    targetSecretKey: input.targetSecretKey,
    trustedLocalProjection: true,
  });
  const initialMetadataSync = await buildInitialDocumentSyncRequest({
    author: input.author,
    containerProjection,
    initialUpdate,
    materializedDocument: containerMetadataDocument,
  });
  return {
    containerId,
    containerMetadataDocument,
    containerMetadataInitialUpdate: initialUpdate,
    containerPlan,
    containerProjection,
    containerRequest: {
      systemSlot: input.systemSlot,
      container: containerPlan.plan.request,
      initialMetadataSync,
      metadataDocument: containerMetadataDocument.plan.request,
    },
    knownContainerKeks,
    systemSlot: input.systemSlot,
  };
}

export async function buildInitialRosterProfileBootstrap(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  encapsulationPublicKey: Uint8Array;
  initialAdminGroup: CreateOrganizationGroupRequest;
  rosterProfileNickname?: string | undefined;
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  targetSecretKey: Uint8Array;
}): Promise<InitialRosterProfileBootstrap> {
  const core = await buildProvisionedChildContainerCore({
    author: input.author,
    icon: null,
    name: ORGANIZATION_ROSTER_PROFILE_CONTAINER_NAME,
    principalPolicies: [
      await verifiedPrincipalPolicyFromInitialGroupRequest(
        input.initialAdminGroup,
      ),
    ],
    rootContainer: input.rootContainer,
    rootContainerProjection: input.rootContainerProjection,
    systemSlot: await deriveOrganizationRosterProfileContainerSystemSlot({
      organizationId: input.author.organizationId,
    }),
    targetSecretKey: input.targetSecretKey,
  });
  const { profile, rosterProfileDocument } = await buildInitialRosterProfile({
    author: input.author,
    containerProjection: core.containerProjection,
    encapsulationPublicKey: input.encapsulationPublicKey,
    knownContainerKeks: core.knownContainerKeks,
    rosterProfileNickname: input.rosterProfileNickname,
    targetSecretKey: input.targetSecretKey,
  });
  return {
    containerId: core.containerId,
    containerMetadataDocument: core.containerMetadataDocument,
    containerMetadataInitialUpdate: core.containerMetadataInitialUpdate,
    containerPlan: core.containerPlan,
    containerRequest: core.containerRequest,
    profileDocument: rosterProfileDocument,
    profileDocumentInitialUpdate: profile.initialUpdate,
    profileDocumentRequest: profile.request,
    systemSlot: core.systemSlot,
  };
}

async function buildInitialRosterProfile(input: InitialRosterProfileInput) {
  const rosterProfileDocument = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection: input.containerProjection,
    documentId: await deriveStableDocumentId(
      getRosterProfileDocumentLocalId({
        organizationId: input.author.organizationId,
        userId: input.author.signerUserId,
      }),
    ),
    knownContainerKeks: input.knownContainerKeks,
    targetSecretKey: input.targetSecretKey,
    trustedLocalProjection: true,
  });
  const profile = await buildProvisionedRosterProfile({
    author: input.author,
    containerProjection: input.containerProjection,
    encapsulationPublicKey: input.encapsulationPublicKey,
    materializedDocument: rosterProfileDocument,
    nickname: input.rosterProfileNickname,
  });
  return { profile, rosterProfileDocument };
}

export async function buildInitialSystemContainerBootstrap(input: {
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  initialAdminGroup: CreateOrganizationGroupRequest;
  rootContainer: InitialRootContainerCreatePlan;
  rootContainerProjection: InitialRootContainerProjection;
  signingPrivateKey: Uint8Array;
  spec: ProvisionedSystemContainerSpec;
  targetSecretKey: Uint8Array;
}): Promise<InitialSystemContainerBootstrap> {
  const core = await buildProvisionedChildContainerCore({
    author: input.author,
    icon: input.spec.icon,
    name: input.spec.name,
    principalPolicies: [
      await verifiedPrincipalPolicyFromInitialGroupRequest(
        input.initialAdminGroup,
      ),
    ],
    rootContainer: input.rootContainer,
    rootContainerProjection: input.rootContainerProjection,
    systemSlot: await deriveContainerSystemSlot({
      definition: input.spec.slotDefinition,
      secretKey: input.signingPrivateKey,
    }),
    targetSecretKey: input.targetSecretKey,
  });
  return {
    containerId: core.containerId,
    containerMetadataDocument: core.containerMetadataDocument,
    containerMetadataInitialUpdate: core.containerMetadataInitialUpdate,
    containerPlan: core.containerPlan,
    containerRequest: core.containerRequest,
    icon: input.spec.icon,
    name: input.spec.name,
    systemSlot: core.systemSlot,
  };
}

async function referencedPrincipalHeadFromInitialGroupRequest(
  input: CreateOrganizationGroupRequest,
): Promise<ContainerGrantPrincipalHead> {
  const head = await groupPolicyMutationHead(input.initialGroupPolicy);
  if (head.principalType !== "group") {
    throw new Error("Initial container grant policy must target a group");
  }
  return { ...head, principalType: "group" };
}

function stableOrganizationProfileId(organizationId: string): Promise<string> {
  return deriveStableDocumentId(
    getOrganizationProfileDocumentLocalId({ organizationId }),
  );
}

async function buildInitialOrganizationProfile(input: {
  author: InitialOrganizationMetadataBootstrapInput["author"];
  containerProjection: ReturnType<
    typeof childContainerWriterProjectionFromCreatePlan
  >;
  knownContainerKeks: ReadonlyMap<string, Uint8Array>;
  organizationProfileName?: string | undefined;
  targetSecretKey: Uint8Array;
}) {
  const organizationProfileDocument = await buildMaterializedDocumentCreatePlan(
    {
      author: input.author,
      containerProjection: input.containerProjection,
      documentId: await stableOrganizationProfileId(
        input.author.organizationId,
      ),
      knownContainerKeks: input.knownContainerKeks,
      targetSecretKey: input.targetSecretKey,
      trustedLocalProjection: true,
    },
  );
  const profile = await buildProvisionedOrganizationProfile({
    author: input.author,
    containerProjection: input.containerProjection,
    materializedDocument: organizationProfileDocument,
    name: input.organizationProfileName,
  });
  return { organizationProfileDocument, profile };
}

/**
 * Builds the org public metadata container and links the encrypted organization
 * profile document (the display name) into it. The container is a child of root
 * born with a read grant to the reserved Members group, so every active roster
 * member can decrypt the org name via the group KEK — without gaining access to
 * the Admins-scoped roster profile container's private PII. The founder can also
 * read it by inheriting root through the Admins group.
 */
export async function buildInitialOrganizationMetadataBootstrap(
  input: InitialOrganizationMetadataBootstrapInput,
): Promise<InitialOrganizationMetadataBootstrap> {
  const core = await buildProvisionedChildContainerCore({
    author: input.author,
    containerId: input.containerId,
    icon: null,
    managedPrincipalGrant: {
      accessLevel: "read",
      principalEncapsulationPublicKey:
        input.initialMemberGroup.initialGroupPolicy.state
          .encapsulationPublicKey,
      principalHead: await referencedPrincipalHeadFromInitialGroupRequest(
        input.initialMemberGroup,
      ),
    },
    name: ORGANIZATION_METADATA_CONTAINER_NAME,
    // Admins justify the parent write; Members justify the read grant.
    principalPolicies: await Promise.all([
      verifiedPrincipalPolicyFromInitialGroupRequest(input.initialAdminGroup),
      verifiedPrincipalPolicyFromInitialGroupRequest(input.initialMemberGroup),
    ]),
    rootContainer: input.rootContainer,
    rootContainerProjection: input.rootContainerProjection,
    systemSlot: await deriveOrganizationMetadataContainerSystemSlot({
      organizationId: input.author.organizationId,
    }),
    targetSecretKey: input.targetSecretKey,
  });
  const { organizationProfileDocument, profile } =
    await buildInitialOrganizationProfile({
      author: input.author,
      containerProjection: core.containerProjection,
      knownContainerKeks: core.knownContainerKeks,
      organizationProfileName: input.organizationProfileName,
      targetSecretKey: input.targetSecretKey,
    });
  return {
    containerId: core.containerId,
    containerMetadataDocument: core.containerMetadataDocument,
    containerMetadataInitialUpdate: core.containerMetadataInitialUpdate,
    containerPlan: core.containerPlan,
    containerRequest: core.containerRequest,
    organizationProfileDocument,
    organizationProfileDocumentRequest: profile.request,
    organizationProfileSnapshot: profile.snapshot,
    systemSlot: core.systemSlot,
  };
}

export async function buildInitialRootProvisioning(input: {
  adminGroup: CreateOrganizationGroupRequest;
  author: NonNullable<ReturnType<typeof resolveDocumentCreateAuthor>>;
  bootstrap: Awaited<ReturnType<typeof createInitialRootMetadataBootstrap>>;
  recipientEncapsulationPublicKey: Uint8Array;
  rootContainerId: string;
  targetSecretKey: Uint8Array;
}) {
  const rootContainer = await buildRootContainerCreatePlan({
    adminGroup: input.adminGroup,
    author: input.author,
    containerId: input.rootContainerId,
    metadataDocumentId: input.bootstrap.metadataDocumentId,
    recipientEncapsulationPublicKey: input.recipientEncapsulationPublicKey,
  });
  const rootContainerProjection = rootContainerWriterProjectionFromCreatePlan(
    rootContainer.plan,
  );
  const rootMetadataDocument = await buildMaterializedDocumentCreatePlan({
    author: input.author,
    containerProjection: rootContainerProjection,
    documentId: input.bootstrap.metadataDocumentId,
    knownContainerKeks: new Map([
      [rootContainer.plan.containerKeyEpochId, rootContainer.containerKey],
    ]),
    targetSecretKey: input.targetSecretKey,
    trustedLocalProjection: true,
  });
  return {
    rootContainer,
    rootContainerProjection,
    rootMetadataDocument,
    rootMetadataDocumentRequest: {
      ...rootMetadataDocument.plan.request,
      initialSync: await buildInitialDocumentSyncRequest({
        author: input.author,
        containerProjection: rootContainerProjection,
        initialUpdate: input.bootstrap.initialUpdate,
        materializedDocument: rootMetadataDocument,
      }),
    },
  };
}
