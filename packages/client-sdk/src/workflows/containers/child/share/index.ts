import {
  type ContainerAccessLevel,
  KeyingVerificationError,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { isStaleParentContainerPathFailure } from "../../../../data/containers/shared/mutationFailures";
import type {
  ContainerMutationAuthor,
  ContainerRotationResult,
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

type ShareRemoteContainerInput = {
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
};

type SharedRemoteContainer = {
  containerKey: Uint8Array;
  plan: ContainerSharePlan;
  response: ContainerMutationResponse;
};

/** A path a head advanced under, which a share plans once more (#2647). */
const STALE_PATH = Symbol("stale-path");

/**
 * Submit through the status-bearing endpoint when the adapter has one. The
 * refusal that ends the share is reported once submission settles, as the
 * plain endpoint's would be; a stale path the share plans again is not.
 */
async function submitShare(
  input: ShareRemoteContainerInput,
  request: ContainerMutationRequest,
  retriesStalePath: boolean,
): Promise<ContainerRotationResult> {
  const options = {
    expectedPaymentRequiredOrganizationId: input.author.organizationId,
  };
  const { shareContainerResult } = input.apiClient;
  if (!shareContainerResult) {
    return submitPlainContainerMutation(() =>
      input.apiClient.shareContainer(input.containerId, request, options),
    );
  }
  const result = await shareContainerResult.call(
    input.apiClient,
    input.containerId,
    request,
    { ...options, reportErrors: false },
  );
  if (result.ok) return { ok: true, data: result.data };
  return retriesStalePath && isStaleParentContainerPathFailure(result)
    ? { ok: false, code: result.code, status: result.status }
    : result;
}

function planShare(
  input: ShareRemoteContainerInput,
  recipientEncapsulationPublicKey: Uint8Array,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
) {
  return resolveShareProjection(input, resolveProjectionUserKey).then(
    (previousProjection) =>
      previousProjection &&
      buildCurrentContainerSharePlan({
        accessLevel: input.accessLevel,
        author: input.author,
        eventId: input.eventId,
        execSql: input.execSql,
        previousProjection,
        recipient: {
          recipientEncapsulationPublicKey,
          subjectId: input.recipientUserId,
          subjectType: "user",
        },
        resolveProjectionUserKey,
        signedAt: input.signedAt,
        stillCurrent: input.stillCurrent,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      }),
  );
}

async function shareRemoteContainerOnce(
  input: ShareRemoteContainerInput,
  recipientEncapsulationPublicKey: Uint8Array,
  resolveProjectionUserKey: ProjectionUserKeyResolver,
  retriesStalePath: boolean,
): Promise<SharedRemoteContainer | typeof STALE_PATH | null> {
  let materializedPlan: Awaited<ReturnType<typeof planShare>>;
  try {
    materializedPlan = await planShare(
      input,
      recipientEncapsulationPublicKey,
      resolveProjectionUserKey,
    );
  } catch (error) {
    // The path the share was handed predates a pin this device has since
    // advanced, most often through its own re-citation. A fresh projection
    // is held to the same pins, so a server that rolls a head back still
    // fails the share, on its second plan.
    if (
      retriesStalePath &&
      error instanceof KeyingVerificationError &&
      error.code === "rollback"
    )
      return STALE_PATH;
    throw error;
  }
  if (!materializedPlan) return null;
  let stalePath = false;
  const shared = await submitAcknowledgedContainerMutation({
    reportSecurityIncident: input.reportSecurityIncident,
    recitationPolicies: [],
    apiClient: input.apiClient,
    author: input.author,
    containerKey: materializedPlan.containerKey,
    execSql: input.execSql,
    plan: materializedPlan.plan,
    stillCurrent: input.stillCurrent,
    submit: async () => {
      const result = await submitShare(
        input,
        materializedPlan.plan.request,
        retriesStalePath,
      );
      stalePath =
        !result.ok &&
        retriesStalePath &&
        isStaleParentContainerPathFailure(result);
      return result;
    },
  });
  return shared ?? (stalePath ? STALE_PATH : null);
}

/**
 * Share a container with a user. A head on the signed path can advance while
 * the share is in flight, most often under this device's own background
 * re-citation of held descendants after a share above it. The API refuses
 * that as a stale path, and the share is planned once more from a fresh
 * projection, as a create under a stale parent is.
 */
export async function shareRemoteContainer(
  input: ShareRemoteContainerInput,
): Promise<SharedRemoteContainer | null> {
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
  const first = await shareRemoteContainerOnce(
    input,
    recipientIdentity.encapsulationPublicKey,
    resolveProjectionUserKey,
    true,
  );
  if (first !== STALE_PATH) return first;
  if (input.stillCurrent?.() === false) return null;
  input.apiClient.evictContainerWriterProjection?.(input.containerId);
  const second = await shareRemoteContainerOnce(
    { ...input, previousProjection: undefined },
    recipientIdentity.encapsulationPublicKey,
    resolveProjectionUserKey,
    false,
  );
  return second === STALE_PATH ? null : second;
}
