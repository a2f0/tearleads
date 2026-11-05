import { toFingerprint } from "@tearleads/crypto";
import type {
  ContainerMutationRequest,
  CreateOrganizationGroupRequest,
  ProvisionedDocumentRequest,
  ProvisionedSystemContainerRequest,
} from "@tearleads/validators/request";
import {
  createOptionalProvisionedDocumentFixture,
  createProvisionedDocumentFixture,
  createProvisionedMetadataContainerFixture,
  createProvisionedTrashFixture,
  deriveOrganizationMetadataContainerSystemSlot,
  deriveOrganizationSystemSlot,
  deriveRosterProfileContainerSystemSlot,
} from "../provisionedSystemContainer";
import {
  childContainerProjectionFromArtifacts,
  createChildContainerArtifacts,
} from "./childContainer";
import { createRootMetadataDocumentRequest } from "./metadataDocument";
import { createRegistrationMetadataRoot } from "./metadataRoot";
import { createRootContainerArtifacts } from "./rootContainer";
import { rootContainerProjectionFromArtifacts } from "./rootProjection";
import { createSignerDeviceId } from "./signing";

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
  initialOrganizationMetadataContainer: ProvisionedSystemContainerRequest;
  initialOrganizationProfileDocument?: ProvisionedDocumentRequest | undefined;
  initialRootContainer: ContainerMutationRequest;
  initialRootMetadataDocument: ProvisionedDocumentRequest;
  initialSystemContainers?: ProvisionedSystemContainerRequest[] | undefined;
  rootMetadataDocumentId: string;
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
        systemSlot: await deriveOrganizationSystemSlot(
          "tearleads.trash",
          input.organizationId,
        ),
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
        systemSlot: await deriveRosterProfileContainerSystemSlot(
          input.organizationId,
        ),
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
  const organizationMetadataContainer = await createRegistrationMetadataRoot({
    ...input,
    signerDeviceId,
    signerKeyFingerprint,
  });
  const organizationMetadataContainerProjection =
    organizationMetadataContainer.projection;
  const organizationMetadataContainerDocument =
    await createRootMetadataDocumentRequest({
      ...documentAuthor,
      containerKey: organizationMetadataContainer.containerKey,
      containerProjection: organizationMetadataContainerProjection,
      rootMetadataDocumentId: organizationMetadataContainer.metadataDocumentId,
    });
  const initialOrganizationMetadataContainer =
    await createProvisionedMetadataContainerFixture({
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
    });
  const organizationProfileDocument = input.organizationProfileDocumentId
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
    initialOrganizationMetadataContainer,
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
