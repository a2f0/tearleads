import type {
  ContainerCreateWithMetadataDocumentResponse,
  DocumentCreateResponse,
  OrganizationProvisioningResponse,
} from "@symcrypt/validators/response";
import { locallyAcknowledgedContainerMutationHead } from "../../data/containers/shared/mutationAcknowledgement";
import { assertDocumentCreateResponseMatchesPlan } from "../../data/documents/shared/responses";
import {
  type LocallyAcknowledgedAccessManifestHead,
  locallyAuthoredAccessManifestHead,
} from "../../data/persistence/locallyAcknowledgedCheckpointPersistence";

type ContainerPlan = Parameters<
  typeof locallyAcknowledgedContainerMutationHead
>[0]["plan"];
type DocumentPlan = Parameters<
  typeof assertDocumentCreateResponseMatchesPlan
>[0];

interface ProvisioningContainerArtifact {
  readonly containerPlan: ContainerPlan;
  readonly metadataDocumentPlan: DocumentPlan;
}

function requireResponse<T>(value: T | undefined, label: string): T {
  if (!value) {
    throw new Error(`Organization provisioning response is missing ${label}`);
  }
  return value;
}

function assertId(
  actual: string | undefined,
  expected: string,
  label: string,
): void {
  if (actual !== expected) {
    throw new Error(`Organization provisioning response ${label} mismatch`);
  }
}

function assertProvisioningIdentity(input: {
  expectedOrganizationId: string;
  expectedUserId: string;
  response: OrganizationProvisioningResponse;
  rootContainerPlan: ContainerPlan;
  rootMetadataDocumentPlan: DocumentPlan;
}): void {
  const { response, rootContainerPlan, rootMetadataDocumentPlan } = input;
  if (
    response.userId !== input.expectedUserId ||
    response.organizationId !== input.expectedOrganizationId ||
    response.rootContainerId !== rootContainerPlan.containerId ||
    response.rootMetadataDocumentId !== rootMetadataDocumentPlan.documentId ||
    response.rootMetadataAccessEpoch !== rootContainerPlan.manifest.epoch ||
    response.rootMetadataAccessStateHash !== rootContainerPlan.manifestHash
  ) {
    throw new Error("Organization provisioning response identity mismatch");
  }
}

async function containerArtifactHeads(input: {
  artifact: ProvisioningContainerArtifact;
  response: ContainerCreateWithMetadataDocumentResponse;
}): Promise<LocallyAcknowledgedAccessManifestHead[]> {
  assertDocumentCreateResponseMatchesPlan(
    input.artifact.metadataDocumentPlan,
    input.response.metadataDocument,
  );
  return [
    await locallyAcknowledgedContainerMutationHead({
      plan: input.artifact.containerPlan,
      response: input.response.container,
    }),
    locallyAuthoredAccessManifestHead(input.artifact.metadataDocumentPlan),
  ];
}

function documentHead(input: {
  plan: DocumentPlan;
  response: DocumentCreateResponse;
}): LocallyAcknowledgedAccessManifestHead {
  assertDocumentCreateResponseMatchesPlan(input.plan, input.response);
  return locallyAuthoredAccessManifestHead(input.plan);
}

export async function provisioningAcknowledgedAccessHeads(input: {
  expectedOrganizationId: string;
  expectedUserId: string;
  organizationMetadata: ProvisioningContainerArtifact;
  organizationProfileDocumentPlan: DocumentPlan;
  response: OrganizationProvisioningResponse;
  rootContainerPlan: ContainerPlan;
  rootMetadataDocumentPlan: DocumentPlan;
  rosterProfile: ProvisioningContainerArtifact;
  rosterProfileDocumentPlan: DocumentPlan;
  systemContainers: readonly ProvisioningContainerArtifact[];
}): Promise<LocallyAcknowledgedAccessManifestHead[]> {
  assertProvisioningIdentity(input);
  const response = input.response;
  assertDocumentCreateResponseMatchesPlan(
    input.rootMetadataDocumentPlan,
    response.rootMetadataDocument,
  );
  const rosterContainer = requireResponse(
    response.rosterProfileContainer,
    "roster profile container",
  );
  const rosterDocument = requireResponse(
    response.rosterProfileDocument,
    "roster profile document",
  );
  const organizationContainer = requireResponse(
    response.organizationMetadataContainer,
    "organization metadata container",
  );
  const organizationDocument = requireResponse(
    response.organizationProfileDocument,
    "organization profile document",
  );
  assertId(
    response.rosterProfileContainerId,
    input.rosterProfile.containerPlan.containerId,
    "roster profile container id",
  );
  assertId(
    response.rosterProfileDocumentId,
    input.rosterProfileDocumentPlan.documentId,
    "roster profile document id",
  );
  assertId(
    response.organizationMetadataContainerId,
    input.organizationMetadata.containerPlan.containerId,
    "organization metadata container id",
  );
  assertId(
    response.organizationProfileDocumentId,
    input.organizationProfileDocumentPlan.documentId,
    "organization profile document id",
  );

  const systemResponses = response.systemContainers;
  if (systemResponses.length !== input.systemContainers.length) {
    throw new Error(
      "Organization provisioning response system container count mismatch",
    );
  }
  const heads: LocallyAcknowledgedAccessManifestHead[] = [
    locallyAuthoredAccessManifestHead(input.rootContainerPlan),
    locallyAuthoredAccessManifestHead(input.rootMetadataDocumentPlan),
    ...(await containerArtifactHeads({
      artifact: input.rosterProfile,
      response: rosterContainer,
    })),
    documentHead({
      plan: input.rosterProfileDocumentPlan,
      response: rosterDocument,
    }),
    ...(await containerArtifactHeads({
      artifact: input.organizationMetadata,
      response: organizationContainer,
    })),
    documentHead({
      plan: input.organizationProfileDocumentPlan,
      response: organizationDocument,
    }),
  ];
  for (const [index, artifact] of input.systemContainers.entries()) {
    const systemResponse = systemResponses[index];
    if (!systemResponse) {
      throw new Error("Organization provisioning system response is missing");
    }
    heads.push(
      ...(await containerArtifactHeads({ artifact, response: systemResponse })),
    );
  }
  return heads;
}
