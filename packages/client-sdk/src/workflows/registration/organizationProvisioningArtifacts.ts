import type { ContainerSystemSlot } from "@symcrypt/validators/containerSystemSlot";
import type {
  CreateOrganizationGroupRequest,
  ProvisionedDocumentRequest,
  ProvisionedSystemContainerRequest,
  RegistrationRequest,
} from "@symcrypt/validators/request";
import type { buildContainerCreatePlan } from "../containers/child/create";
import type { buildRootContainerCreatePlan } from "../containers/root/create";
import type { buildMaterializedDocumentCreatePlan } from "../documents/create";
import type { createInitialRootMetadataBootstrap } from "./rootMetadataBootstrap";

export type InitialRootMetadataDocument = Awaited<
  ReturnType<typeof buildMaterializedDocumentCreatePlan>
>;

export type InitialRootContainerCreatePlan = Awaited<
  ReturnType<typeof buildRootContainerCreatePlan>
>;

export interface InitialSystemContainerCreatePlan {
  containerKey: Uint8Array;
  plan: Awaited<ReturnType<typeof buildContainerCreatePlan>>;
}

export interface InitialRosterProfileBootstrap {
  containerId: string;
  containerMetadataDocument: InitialRootMetadataDocument;
  containerMetadataInitialUpdate: Uint8Array;
  containerPlan: InitialSystemContainerCreatePlan;
  containerRequest: ProvisionedSystemContainerRequest;
  profileDocument: InitialRootMetadataDocument;
  profileDocumentInitialUpdate: Uint8Array;
  profileDocumentRequest: ProvisionedDocumentRequest;
  systemSlot: ContainerSystemSlot;
}

export interface InitialSystemContainerBootstrap {
  containerId: string;
  containerMetadataDocument: InitialRootMetadataDocument;
  containerMetadataInitialUpdate: Uint8Array;
  containerPlan: InitialSystemContainerCreatePlan;
  containerRequest: ProvisionedSystemContainerRequest;
  icon: string | null;
  name: string;
  systemSlot: ContainerSystemSlot;
}

export interface InitialOrganizationMetadataBootstrap {
  containerId: string;
  containerMetadataDocument: InitialRootMetadataDocument;
  containerMetadataInitialUpdate: Uint8Array;
  containerPlan: InitialSystemContainerCreatePlan;
  containerRequest: ProvisionedSystemContainerRequest;
  organizationProfileDocument: InitialRootMetadataDocument;
  organizationProfileDocumentRequest: ProvisionedDocumentRequest;
  organizationProfileSnapshot: string;
  systemSlot: ContainerSystemSlot;
}

export interface OrganizationProvisioningArtifacts {
  bootstrap: Awaited<ReturnType<typeof createInitialRootMetadataBootstrap>>;
  initialAdminGroup: CreateOrganizationGroupRequest;
  initialMemberGroup: CreateOrganizationGroupRequest;
  initialOrganizationPolicy: RegistrationRequest["initialOrganizationPolicy"];
  initialRootContainer: RegistrationRequest["initialRootContainer"];
  organizationId: string;
  organizationMetadataBootstrap: InitialOrganizationMetadataBootstrap;
  rootContainer: InitialRootContainerCreatePlan;
  rootMetadataDocument: InitialRootMetadataDocument;
  rootMetadataDocumentRequest: ProvisionedDocumentRequest;
  rosterProfileBootstrap: InitialRosterProfileBootstrap;
  systemContainerBootstraps: InitialSystemContainerBootstrap[];
}
