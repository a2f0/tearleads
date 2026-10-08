import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import {
  commitProjectionCheckpoints,
  createProjectionCheckpointContext,
  observePrincipalPolicy,
} from "../../src/data/keyingProjectionVerification/checkpointContext";
import {
  encodeOrganizationAuthorityDescriptor,
  parseOrganizationAuthorityDescriptor,
} from "../../src/data/principals/organizationAuthorityDescriptor";
import { createRuntimePrincipalPolicyWarmer } from "../../src/workflows/principals/runtimePolicyWarmer";
import { createHistoricalPolicyPurgeFixture } from "./documentPurgeHistoricalPolicy";
import { createAuthorityRecoveryFixture } from "./principalAuthorityRecovery";
import {
  principalPolicyHead,
  signedPrincipalPolicyBundle,
} from "./principalPolicyFixtures";
import { projectionHistoryPages } from "./projectionPolicyHistory";

export async function createNewerPolicyPurgeFixture() {
  const organizationId = crypto.randomUUID();
  const fixture = await createHistoricalPolicyPurgeFixture(
    false,
    organizationId,
  );
  const [organization, admin, group] = fixture.bundles;
  if (!organization || !admin || !group)
    throw new Error("Missing fixture policies");
  const advance = async (
    bundle: PrincipalPolicyBundleResponse,
    ciphertext = bundle.currentPayload.ciphertext,
  ) =>
    signedPrincipalPolicyBundle({
      memberEnvelopes: bundle.currentMemberEnvelopes.envelopes,
      payloadCiphertext: ciphertext,
      projection: bundle.currentProjection,
      previousStates: [
        ...bundle.previousStates,
        {
          state: bundle.currentState,
          projection: bundle.currentProjection,
          grants: bundle.currentGrants,
        },
      ],
      signing: {
        ...bundle.currentState,
        grants: bundle.currentGrants,
        version: bundle.currentState.version + 1,
        prevStateHash: bundle.currentState.stateHash,
      },
      signingPrivateKey: fixture.signingPrivateKey,
    });
  const newerAdmin = await advance(admin);
  const newerGroup = await advance(group);
  const descriptor = parseOrganizationAuthorityDescriptor(
    organization.currentPayload.ciphertext,
  );
  const newerOrganization = await advance(
    organization,
    encodeOrganizationAuthorityDescriptor({
      ...descriptor,
      groupHeads: descriptor.groupHeads.map((head) => {
        const newer = [newerAdmin, newerGroup].find(
          (bundle) => bundle.currentState.principalId === head.principalId,
        );
        return newer
          ? { ...principalPolicyHead(newer), principalType: "group" as const }
          : head;
      }),
    }),
  );
  const f = await createAuthorityRecoveryFixture({
    directory: newerOrganization,
    admin: newerAdmin,
    group: newerGroup,
    organizationId,
    resolveTrustedUserIdentity: fixture.resolveUserKey,
  });
  const incidents: unknown[] = [];
  const warmer = createRuntimePrincipalPolicyWarmer({
    apiClient: {
      getPrincipalPolicyPages: f.options.apiClient.getPrincipalPolicyPages.bind(
        f.options.apiClient,
      ),
      ...projectionHistoryPages(fixture.bundles),
      getCurrentPrincipalPolicy: async () => {
        throw new Error("Full policy read");
      },
    },
    infra: { execSql: f.options.execSql },
    state: { online: true },
    resolveTrustedUserIdentity: fixture.resolveUserKey,
    util: {
      log: () => {},
      reportSecurityIncident: async (error) => {
        incidents.push(error);
      },
    },
    withPrincipalHistoryProtection: (operation) =>
      operation({ protection: f.options.protection, stillCurrent: () => true }),
  });
  try {
    const resolved = await warmer.resolveReference?.({
      organizationId,
      reference: principalPolicyHead(newerGroup),
    });
    if (!resolved) throw new Error("Missing current-policy resolver");
    const context = createProjectionCheckpointContext({
      execSql: f.options.execSql,
      organizationId,
    });
    for (const policy of [...resolved.dependencies, resolved.policy])
      observePrincipalPolicy(context, policy);
    await commitProjectionCheckpoints(context);
    return {
      ...f,
      advance,
      warmer,
      fixture,
      organizationId,
      incidents,
      newer: [newerOrganization, newerAdmin, newerGroup],
    };
  } catch (error) {
    f.close();
    throw error;
  }
}
