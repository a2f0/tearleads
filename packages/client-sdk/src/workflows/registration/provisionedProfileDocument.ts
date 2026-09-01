import { bytesToBase64 } from "@tearleads/encoding";
import type { ProvisionedDocumentRequest } from "@tearleads/validators/request";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type {
  DocumentCreateAuthor,
  MaterializedDocumentCreatePlan,
} from "../../data/documents/shared/types";
import { buildInitialDocumentSyncRequest } from "../documents/initialSync";
import {
  createInitializedOrganizationProfileDocument,
  DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
} from "../organizations/organizationProfile";
import {
  createInitializedRosterProfileDocument,
  DEFAULT_ROSTER_PROFILE_SELF_NICKNAME,
} from "../organizations/rosterProfileContainer";

interface ProvisionedProfileInput {
  author: DocumentCreateAuthor;
  containerProjection: ContainerWriterProjectionResponse;
  materializedDocument: MaterializedDocumentCreatePlan;
}

async function buildProvisionedDocumentRequest(
  input: ProvisionedProfileInput & { initialUpdate: Uint8Array },
): Promise<ProvisionedDocumentRequest> {
  return {
    ...input.materializedDocument.plan.request,
    initialSync: await buildInitialDocumentSyncRequest(input),
  };
}

export async function buildProvisionedOrganizationProfile(
  input: ProvisionedProfileInput & { name?: string | undefined },
) {
  const initialized = await createInitializedOrganizationProfileDocument({
    name: input.name ?? DEFAULT_PERSONAL_ORGANIZATION_PROFILE_NAME,
  });
  const request = await buildProvisionedDocumentRequest({
    ...input,
    initialUpdate: initialized.initialUpdate,
  });
  return { ...initialized, request };
}

export async function buildProvisionedRosterProfile(
  input: ProvisionedProfileInput & {
    encapsulationPublicKey: Uint8Array;
    nickname?: string | undefined;
  },
) {
  const initialized = await createInitializedRosterProfileDocument({
    encapsulationPublicKey: bytesToBase64(input.encapsulationPublicKey),
    isSelf: true,
    nickname: input.nickname ?? DEFAULT_ROSTER_PROFILE_SELF_NICKNAME,
    userId: input.author.signerUserId,
  });
  const request = await buildProvisionedDocumentRequest({
    ...input,
    initialUpdate: initialized.initialUpdate,
  });
  return { ...initialized, request };
}
