import type { ContainerAccessLevel } from "@tearleads/crypto";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import type {
  ContainerMutationAuthor,
  ContainerShareApi,
  ContainerSharePlan,
  MaterializedContainerSharePlan,
} from "../../../../data/containers/shared/types";
import {
  nullOnProjectionVerificationCancellation,
  type ProjectionUserKeyResolver,
  type ReferencedPrincipalPolicyWarmer,
  requireProjectionUserKeyResolver,
} from "../../../../data/keyingProjectionVerification";
import type { SecurityIncidentReporter } from "../../../../data/shared/securityIncidents";
import type { ExecSql } from "../../../../data/sqlite/sqlSchema";
import {
  requireTrustedUserIdentityResolver,
  type TrustedUserIdentityResolver,
} from "../../../../data/trustedUserIdentity";
import {
  submitAcknowledgedContainerMutation,
  submitPlainContainerMutation,
} from "../mutationSubmit";
import { buildMaterializedContainerSharePlan } from "./shareMaterialization";
import { resolveShareProjection } from "./shareProjection";

async function buildCurrentContainerSharePlan(
  input: Parameters<typeof buildMaterializedContainerSharePlan>[0],
): Promise<MaterializedContainerSharePlan | null> {
  return nullOnProjectionVerificationCancellation(() =>
    buildMaterializedContainerSharePlan(input),
  );
}

export async function shareRemoteContainer(input: {
  reportSecurityIncident: SecurityIncidentReporter;
  accessLevel: ContainerAccessLevel;
  apiClient: ContainerShareApi;
  author: ContainerMutationAuthor;
  containerId: string;
  eventId?: string | undefined;
  execSql: ExecSql;
  previousProjection?: ContainerWriterProjectionResponse | undefined;
  recipientUserId: string;
  resolveProjectionUserKey: ProjectionUserKeyResolver;
  resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  signedAt?: string | undefined;
  stillCurrent?: (() => boolean) | undefined;
  targetSecretKey: Uint8Array;
  warmReferencedPrincipalPolicies?: ReferencedPrincipalPolicyWarmer | undefined;
}): Promise<{
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
  response: ContainerMutationResponse;
} | null> {
  const resolveProjectionUserKey = requireProjectionUserKeyResolver(
    input.resolveProjectionUserKey,
    "Remote container share",
  );
  const resolveTrustedUserIdentity = requireTrustedUserIdentityResolver(
    input.resolveTrustedUserIdentity,
  );
  const recipientIdentity = await resolveTrustedUserIdentity(
    input.recipientUserId,
  );
  if (!recipientIdentity || input.stillCurrent?.() === false) {
    return null;
  }
  const previousProjection = await resolveShareProjection(
    input,
    resolveProjectionUserKey,
  );
  if (!previousProjection) return null;

  const materializedPlan = await buildCurrentContainerSharePlan({
    accessLevel: input.accessLevel,
    author: input.author,
    eventId: input.eventId,
    execSql: input.execSql,
    previousProjection,
    recipient: {
      recipientEncapsulationPublicKey: recipientIdentity.encapsulationPublicKey,
      subjectId: input.recipientUserId,
      subjectType: "user",
    },
    resolveProjectionUserKey,
    signedAt: input.signedAt,
    stillCurrent: input.stillCurrent,
    targetSecretKey: input.targetSecretKey,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  if (!materializedPlan) return null;
  return submitAcknowledgedContainerMutation({
    reportSecurityIncident: input.reportSecurityIncident,
    recitationPolicies: [],
    apiClient: input.apiClient,
    author: input.author,
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    plan: materializedPlan.plan,
    stillCurrent: input.stillCurrent,
    submit: () =>
      submitPlainContainerMutation(() =>
        input.apiClient.shareContainer(
          input.containerId,
          materializedPlan.plan.request,
          {
            expectedPaymentRequiredOrganizationId: input.author.organizationId,
          },
        ),
      ),
  });
}
