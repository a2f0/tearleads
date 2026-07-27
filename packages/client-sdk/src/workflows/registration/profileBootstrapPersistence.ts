import { base64ToBytes } from "@tearleads/encoding";
import type { ProvisionedDocumentRequest } from "@tearleads/validators/request";
import type { OrganizationProvisioningResponse } from "@tearleads/validators/response";
import { persistedDocumentCreateStateFromResponse } from "../../data/documents/shared/responses";
import type { MaterializedDocumentCreatePlan } from "../../data/documents/shared/types";
import { getOrganizationProfileDocumentLocalId } from "../organizations/organizationProfile";
import { getRosterProfileDocumentLocalId } from "../organizations/rosterProfileContainer";
import type { RegistrationBootstrapInput } from "./persistRegistrationBootstrap";

interface ProfileBootstrapInput {
  containerId: string;
  initialUpdate: Uint8Array;
  materializedDocument: MaterializedDocumentCreatePlan;
  request: ProvisionedDocumentRequest;
  response: OrganizationProvisioningResponse;
}

function initialUpdateCommitted(
  input: Pick<ProfileBootstrapInput, "request" | "response">,
): boolean {
  const updateId = input.request.initialSync.outgoingUpdates[0]?.id;
  return (
    updateId !== undefined &&
    input.response.committedProfileUpdateIds.includes(updateId)
  );
}

export function buildOrganizationProfileBootstrapInput(
  input: Omit<ProfileBootstrapInput, "initialUpdate"> & { snapshot: string },
): RegistrationBootstrapInput["organizationProfileDocument"] {
  const document = input.response.organizationProfileDocument;
  if (!document) {
    return undefined;
  }
  return {
    accessEpoch: 1,
    accessStateHash: document.accessManifest.manifestHash,
    containerId: input.containerId,
    documentId: document.id,
    documentState: persistedDocumentCreateStateFromResponse(
      input.materializedDocument.plan,
      document,
    ),
    initialUpdate: base64ToBytes(input.snapshot),
    initialUpdateCommitted: initialUpdateCommitted(input),
    localId: getOrganizationProfileDocumentLocalId({
      organizationId: input.response.organizationId,
    }),
  };
}

export function buildRosterProfileBootstrapInput(
  input: ProfileBootstrapInput,
): RegistrationBootstrapInput["rosterProfileDocument"] {
  const document = input.response.rosterProfileDocument;
  if (!document) {
    return undefined;
  }
  return {
    accessEpoch: 1,
    accessStateHash: document.accessManifest.manifestHash,
    containerId: input.containerId,
    documentId: document.id,
    documentState: persistedDocumentCreateStateFromResponse(
      input.materializedDocument.plan,
      document,
    ),
    initialUpdate: input.initialUpdate,
    initialUpdateCommitted: initialUpdateCommitted(input),
    localId: getRosterProfileDocumentLocalId({
      organizationId: input.response.organizationId,
      userId: input.response.userId,
    }),
  };
}
