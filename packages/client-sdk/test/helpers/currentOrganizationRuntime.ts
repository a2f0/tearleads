import { generateKemSeedAndKeyPair } from "@tearleads/crypto";
import type { ContainerWriterProjectionResponse } from "@tearleads/validators/response";
import { inheritPrincipalHistoryProtection } from "../../src/data/principals/principalHistoryRuntime";
import { createMutationResponseFromRequest } from "./containerFixtures";
import { createWorkflowInputFixture } from "./internalRuntimeFixtures";
import { createAuthorityRecoveryFixture } from "./principalAuthorityRecovery";
import {
  projectionDirectoryPayload,
  projectionPolicySource,
} from "./projectionPolicyHistory";
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
  options: { allowFullReads?: boolean; withLease?: boolean } = {},
) {
  const signed = await createReservedGroupAdvance("Members");
  const organizationId = signed.artifacts.organizationId;
  const f = await createAuthorityRecoveryFixture({
    directory: signed.advancedDirectory,
    admin: signed.admin,
    group: signed.advanced,
    organizationId,
    resolveTrustedUserIdentity: signed.resolveTrustedUserIdentity,
  });
  const projection = await metadataProjection(signed);
  let fullReads = 0;
  f.options.apiClient.getCurrentPrincipalPolicy = async (type, id) => {
    fullReads += 1;
    if (!options.allowFullReads) throw new Error("Unexpected full-policy read");
    return signed.currentPolicy(type, id);
  };
  f.options.apiClient.getContainerWriterProjection = async () => projection;
  const input = createWorkflowInputFixture({
    apiClient: f.options.apiClient,
    auth: { organizationId, userId: "founder" },
    execSql: f.options.execSql,
    resolveTrustedUserIdentity: signed.resolveTrustedUserIdentity,
  });
  const runtime = inheritPrincipalHistoryProtection(
    options.withLease === false
      ? {}
      : {
          withPrincipalHistoryProtection: async <T>(
            work: (lease: {
              protection: typeof f.options.protection;
              stillCurrent: () => boolean;
            }) => Promise<T>,
          ) =>
            work({
              protection: f.options.protection,
              stillCurrent: () => true,
            }),
        },
    {
      ...input,
      crypto: {
        ...input.crypto,
        encapsulationKeyPair: generateKemSeedAndKeyPair(),
      },
    },
  );
  return { ...f, runtime, signed, projection, fullReads: () => fullReads };
}
