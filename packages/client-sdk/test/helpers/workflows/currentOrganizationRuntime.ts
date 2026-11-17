import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import type { PrincipalHistoryProtectionLease } from "../../../src/data/principals/principalHistoryProtection";
import { createMutationResponseFromRequest } from "../data/containerFixtures";
import { organizationPolicyBundleFromInitialRequest } from "../data/principalPolicyFixtures";
import {
  projectionDirectoryPayload,
  projectionHistoryPages,
  projectionPolicySource,
} from "../data/projectionPolicyPages";
import { createWorkflowInputFixture } from "./internalRuntimeFixtures";
import { createAuthorityRecoveryFixture } from "./principalAuthorityRecovery";
import { createReservedGroupAdvance } from "./reservedGroupAdvance";

async function metadataProjection(
  signed: Awaited<ReturnType<typeof createReservedGroupAdvance>>,
): Promise<ContainerWriterProjectionResponse> {
  const created = await createMutationResponseFromRequest(
    signed.artifacts.organizationMetadataBootstrap.containerRequest.container,
  );
  return {
    containerId: created.containerId,
    containerKeks: [created.containerKek],
    organizationId: signed.artifacts.organizationId,
    path: [created.accessManifest],
    policyEvidence: {
      groups: [signed.admin, signed.advanced].map(projectionPolicySource),
      organization: projectionPolicySource(signed.advancedDirectory),
      organizationPayloads: [
        projectionDirectoryPayload(signed.advancedDirectory),
      ],
    },
  };
}

export async function createCurrentOrganizationRuntimeFixture(
  options: {
    allowFullReads?: boolean;
    withLease?: boolean;
    aligned?: boolean;
  } = {},
) {
  const signed = await createReservedGroupAdvance("Members");
  const organizationId = signed.artifacts.organizationId;
  const directory = options.aligned
    ? await organizationPolicyBundleFromInitialRequest(
        organizationId,
        signed.artifacts.initialOrganizationPolicy,
      )
    : signed.advancedDirectory;
  const members = options.aligned ? signed.members : signed.advanced;
  const f = await createAuthorityRecoveryFixture({
    directory,
    admin: signed.admin,
    group: members,
    organizationId,
    resolveTrustedUserIdentity: signed.resolveTrustedUserIdentity,
  });
  const projection = await metadataProjection(signed);
  if (options.aligned) {
    projection.policyEvidence = {
      groups: [signed.admin, members].map(projectionPolicySource),
      organization: projectionPolicySource(directory),
      organizationPayloads: [projectionDirectoryPayload(directory)],
    };
  }
  f.apiClient.getProjectionPolicyHistoryPages = projectionHistoryPages([
    directory,
    signed.admin,
    members,
  ]).getProjectionPolicyHistoryPages;
  let fullReads = 0;
  f.apiClient.getCurrentPrincipalPolicy = async (_, id) => {
    fullReads += 1;
    if (!options.allowFullReads) throw new Error("Unexpected full-policy read");
    return f.policies.get(id) ?? null;
  };
  f.apiClient.getContainerWriterProjection = async () => projection;
  const lease: PrincipalHistoryProtectionLease | undefined =
    options.withLease === false
      ? undefined
      : async (work) =>
          work({
            protection: f.options.protection,
            stillCurrent: () => true,
          });
  const input = createWorkflowInputFixture({
    apiClient: f.apiClient,
    auth: { organizationId, userId: "founder" },
    execSql: f.options.execSql,
    resolveTrustedUserIdentity: signed.resolveTrustedUserIdentity,
    withPrincipalHistoryProtection: lease,
  });
  const runtime = {
    ...input,
    crypto: {
      ...input.crypto,
      encapsulationKeyPair: signed.identity,
    },
  };
  return {
    ...f,
    runtime,
    lease,
    signed,
    projection,
    fullReads: () => fullReads,
  };
}
