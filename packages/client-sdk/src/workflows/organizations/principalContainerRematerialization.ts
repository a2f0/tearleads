import type {
  ContainerDirectGrant,
  PrincipalContainerGrant,
  VerifiedPrincipalPolicy,
} from "@tearleads/crypto";
import type { ContainerMutationRequest } from "@tearleads/validators/request";
import type {
  ContainerMutationResponse,
  ContainerWriterProjectionResponse,
} from "@tearleads/validators/response";
import { rememberVerifiedContainerHeads } from "../../data/containers/shared/heldContainerHeads";
import type { AuthoredContainerMutationHead } from "../../data/containers/shared/mutationAcknowledgement";
import { acknowledgeContainerMutationBatch } from "../../data/containers/shared/mutationAcknowledgement";
import {
  getTargetContainerContext,
  readContainerState,
} from "../../data/containers/shared/projection";
import type { ContainerReciteApi } from "../../data/containers/shared/reciteApi";
import type {
  ContainerMutationAuthor,
  MaterializedContainerRekeyPlan,
  MaterializedContainerRevokePlan,
  MaterializedContainerSharePlan,
} from "../../data/containers/shared/types";
import {
  type PrincipalPolicyCache,
  type ReferencedPrincipalPolicyWarmer,
  verifyContainerWriterProjection,
} from "../../data/keyingProjectionVerification";
import { referencedPrincipalPolicyKey } from "../../data/keyingProjectionVerification/principalPolicyCache";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type { SecurityIncidentReporter } from "../../data/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import type { TrustedUserIdentityResolver } from "../../data/trustedUserIdentity";
import { planCarriedDescendantRekeys } from "../containers/child/carriedDescendantRekeys";
import { scheduleHeldDescendantRecitations } from "../containers/child/recite";
import { buildMaterializedContainerRekeyPlan } from "../containers/child/rekey";
import {
  containerWriterProjectionFromRotationPlan,
  isSpeculativeContainerWriterProjection,
  rebaseContainerWriterProjection,
} from "../containers/child/rekeyProjection";
import { buildMaterializedContainerRevokePlan } from "../containers/child/revoke";
import { buildMaterializedContainerSharePlan } from "../containers/child/shareMaterialization";

interface RematerializationApi extends ContainerReciteApi {
  getContainerWriterProjection(
    containerId: string,
  ): Promise<ContainerWriterProjectionResponse | null>;
}

interface PrincipalContainerRematerializationInput {
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly apiClient: RematerializationApi;
  readonly author: ContainerMutationAuthor;
  readonly execSql: ExecSql;
  readonly grants: readonly PrincipalContainerGrant[];
  readonly groupId: string;
  readonly nextPolicy: VerifiedPrincipalPolicy;
  readonly revokedContainerId?: string | undefined;
  readonly resolveTrustedUserIdentity: TrustedUserIdentityResolver;
  readonly stillCurrent?: (() => boolean) | undefined;
  readonly targetSecretKey: Uint8Array;
  readonly warmReferencedPrincipalPolicies?:
    | ReferencedPrincipalPolicyWarmer
    | undefined;
}

function matchingGroupGrant(input: {
  readonly directGrants: readonly ContainerDirectGrant[];
  readonly groupId: string;
}): ContainerDirectGrant | null {
  return (
    input.directGrants.find(
      (grant) =>
        grant.subjectType === "group" && grant.subjectId === input.groupId,
    ) ?? null
  );
}

function referencedGroupKeyEpoch(input: {
  readonly groupId: string;
  readonly referencedPrincipalHeads: ReturnType<
    typeof readContainerState
  >["referencedPrincipalHeads"];
}): number | null {
  return (
    input.referencedPrincipalHeads.find(
      (head) =>
        head.principalType === "group" && head.principalId === input.groupId,
    )?.keyEpoch ?? null
  );
}

async function loadGrantedContainerContext(
  input: PrincipalContainerRematerializationInput,
  grantRow: PrincipalContainerGrant,
  projection: ContainerWriterProjectionResponse,
  principalPolicyCache: PrincipalPolicyCache,
) {
  // A projection re-rooted on a rotation this batch has yet to commit must
  // not pin anything: its heads are speculative until acknowledged, and a
  // pin past the group's served head would refuse the other served paths.
  await verifyContainerWriterProjection({
    execSql: input.execSql,
    persistVerificationCheckpoints:
      !isSpeculativeContainerWriterProjection(projection),
    principalPolicyCache,
    projection,
    resolveUserKey: createProjectionUserKeyResolver({
      resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
    }),
    stillCurrent: input.stillCurrent,
    warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
  });
  const state = readContainerState(
    getTargetContainerContext(projection).manifest,
  );
  const grant = matchingGroupGrant({
    directGrants: state.directGrants,
    groupId: input.groupId,
  });
  if (grant && grant.accessLevel !== grantRow.accessLevel) {
    const nextGrant = input.nextPolicy.grants.find(
      (candidate) => candidate.containerId === grantRow.containerId,
    );
    if (!nextGrant || nextGrant.accessLevel !== grantRow.accessLevel) {
      throw new Error(
        `Container ${grantRow.containerId} does not contain the expected group grant`,
      );
    }
  }
  const referencedKeyEpoch = referencedGroupKeyEpoch({
    groupId: input.groupId,
    referencedPrincipalHeads: state.referencedPrincipalHeads,
  });
  if (grant && referencedKeyEpoch === null) {
    throw new Error(
      `Container ${grantRow.containerId} is missing its group reference`,
    );
  }
  return { grant, projection, referencedKeyEpoch };
}

export async function buildPrincipalContainerRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
): Promise<ContainerMutationRequest[]> {
  return (await buildPrincipalContainerRematerializationPlans(input)).map(
    (entry) => entry.planned.plan.request,
  );
}

type MaterializedPrincipalContainerMutationPlan =
  | MaterializedContainerRekeyPlan
  | MaterializedContainerRevokePlan
  | MaterializedContainerSharePlan;

/** A plan with the served projection it extends, kept for carried rekeys. */
interface PlannedRematerialization {
  readonly planned: MaterializedPrincipalContainerMutationPlan;
  readonly previousProjection: ContainerWriterProjectionResponse;
}

export interface PreparedPrincipalContainerRematerializationBatch {
  readonly acknowledge: (
    responses: readonly ContainerMutationResponse[],
    stillCurrent?: (() => boolean) | undefined,
  ) => Promise<void>;
  /**
   * Sign the descendant rekeys the server named for this batch's rotations,
   * against the paths the batch will leave behind. Appended to `requests`;
   * `acknowledge` then expects their responses in the same order.
   */
  readonly carry: (
    requiredContainerIds: readonly string[],
  ) => Promise<readonly ContainerMutationRequest[]>;
  readonly plans: readonly MaterializedPrincipalContainerMutationPlan[];
  readonly requests: readonly ContainerMutationRequest[];
}

function authoredMutationHead(
  planned: MaterializedPrincipalContainerMutationPlan,
): AuthoredContainerMutationHead {
  return planned.plan;
}

async function buildPrincipalContainerRematerializationPlan(input: {
  readonly grantRow: PrincipalContainerGrant;
  /** Holds the policy this batch commits, which rebased paths already cite. */
  readonly principalPolicyCache: PrincipalPolicyCache;
  /** The served projection, re-rooted on any rotation planned above it. */
  readonly projection: ContainerWriterProjectionResponse;
  readonly rematerialization: PrincipalContainerRematerializationInput;
  readonly resolveProjectionUserKey: ReturnType<
    typeof createProjectionUserKeyResolver
  >;
}): Promise<PlannedRematerialization> {
  const { grantRow, rematerialization } = input;
  const { grant, projection, referencedKeyEpoch } =
    await loadGrantedContainerContext(
      rematerialization,
      grantRow,
      input.projection,
      input.principalPolicyCache,
    );
  const previousProjection = projection;
  const nextGrant = rematerialization.nextPolicy.grants.find(
    (candidate) => candidate.containerId === grantRow.containerId,
  );
  const author = {
    ...rematerialization.author,
    organizationId: projection.organizationId,
  };
  const sharedInput = {
    author,
    execSql: rematerialization.execSql,
    // Planning against a path this batch has yet to commit pins nothing; the
    // acknowledgement advances every head at once. The rekey planner applies
    // this rule itself; revoke and grant planning take it from here.
    persistVerificationCheckpoints:
      !isSpeculativeContainerWriterProjection(projection),
    previousProjection: projection,
    principalPolicyCache: input.principalPolicyCache,
    resolveProjectionUserKey: input.resolveProjectionUserKey,
    stillCurrent: rematerialization.stillCurrent,
    targetSecretKey: rematerialization.targetSecretKey,
    warmReferencedPrincipalPolicies:
      rematerialization.warmReferencedPrincipalPolicies,
  };
  if (grantRow.containerId === rematerialization.revokedContainerId) {
    if (!grant) {
      throw new Error(
        `Container ${grantRow.containerId} does not contain the revoked group grant`,
      );
    }
    return {
      planned: await buildMaterializedContainerRevokePlan({
        ...sharedInput,
        replacementPrincipalPolicy: rematerialization.nextPolicy,
        revokedSubject: {
          subjectId: rematerialization.groupId,
          subjectType: "group",
        },
      }),
      previousProjection,
    };
  }
  if (!grant || grant.accessLevel !== nextGrant?.accessLevel) {
    if (!nextGrant) {
      throw new Error(
        `Container ${grantRow.containerId} is absent from the next group grant set`,
      );
    }
    return {
      planned: await buildMaterializedContainerSharePlan({
        ...sharedInput,
        accessLevel: nextGrant.accessLevel,
        recipient: {
          principalPolicy: rematerialization.nextPolicy,
          subjectId: rematerialization.groupId,
          subjectType: "group",
        },
      }),
      previousProjection,
    };
  }
  if (referencedKeyEpoch === rematerialization.nextPolicy.keyEpoch) {
    return {
      planned: await buildMaterializedContainerSharePlan({
        ...sharedInput,
        accessLevel: grant.accessLevel,
        recipient: {
          principalPolicy: rematerialization.nextPolicy,
          subjectId: rematerialization.groupId,
          subjectType: "group",
        },
      }),
      previousProjection,
    };
  }
  return {
    planned: await buildMaterializedContainerRekeyPlan({
      ...sharedInput,
      replacementPrincipalPolicy: rematerialization.nextPolicy,
    }),
    previousProjection,
  };
}

/**
 * Order a batch parent-first, by served depth. A group granted on a container
 * and on one of its descendants rotates both, and the lower rotation must be
 * signed against the epoch the upper one mints in this same batch, or it
 * extends a head the batch itself retires. Ties keep id order for stability.
 */
export function orderRematerializationsParentFirst<
  T extends {
    readonly grantRow: { readonly containerId: string };
    readonly projection: { readonly path: readonly unknown[] };
  },
>(batch: T[]): T[] {
  return batch.sort(
    (left, right) =>
      left.projection.path.length - right.projection.path.length ||
      left.grantRow.containerId.localeCompare(right.grantRow.containerId),
  );
}

/** An in-memory cache holding only the policy this batch is about to commit. */
function seededPrincipalPolicyCache(
  nextPolicy: VerifiedPrincipalPolicy,
): PrincipalPolicyCache {
  return new Map([
    [
      referencedPrincipalPolicyKey({
        keyEpoch: nextPolicy.keyEpoch,
        keyFingerprint: nextPolicy.state.keyFingerprint,
        principalId: nextPolicy.principalId,
        principalType: nextPolicy.principalType,
        stateHash: nextPolicy.stateHash,
        version: nextPolicy.version,
      }),
      nextPolicy,
    ],
  ]);
}

async function buildPrincipalContainerRematerializationPlans(
  input: PrincipalContainerRematerializationInput,
): Promise<PlannedRematerialization[]> {
  if (
    input.revokedContainerId &&
    !input.grants.some(
      (grant) => grant.containerId === input.revokedContainerId,
    )
  ) {
    throw new Error("Revoked container is not granted to the group");
  }
  const resolveProjectionUserKey = createProjectionUserKeyResolver({
    resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
  });
  const served: Array<{
    grantRow: PrincipalContainerGrant;
    projection: ContainerWriterProjectionResponse;
  }> = [];
  for (const grantRow of [...input.grants].sort((left, right) =>
    left.containerId.localeCompare(right.containerId),
  )) {
    const projection = await input.apiClient.getContainerWriterProjection(
      grantRow.containerId,
    );
    if (!projection) {
      throw new Error(
        `Container ${grantRow.containerId} could not be prepared for principal rotation`,
      );
    }
    served.push({ grantRow, projection });
  }
  orderRematerializationsParentFirst(served);
  // A rotation planned above cites the group at the head this batch commits,
  // which no store holds yet; the cache is what lets a rebased path verify.
  const principalPolicyCache = seededPrincipalPolicyCache(input.nextPolicy);
  const plans: PlannedRematerialization[] = [];
  const rotatedAbove: Pick<
    ContainerWriterProjectionResponse,
    "containerKeks" | "path"
  >[] = [];
  for (const { grantRow, projection } of served) {
    const rebased = rotatedAbove.reduce<ContainerWriterProjectionResponse>(
      (current, rotated) =>
        rebaseContainerWriterProjection(current, rotated) ?? current,
      projection,
    );
    const entry = await buildPrincipalContainerRematerializationPlan({
      grantRow,
      principalPolicyCache,
      projection: rebased,
      rematerialization: input,
      resolveProjectionUserKey,
    });
    plans.push(entry);
    const rotated = await rotatedPath(entry);
    if (rotated) rotatedAbove.push(rotated);
  }
  return plans;
}

/** A rotation's speculative path once accepted; null for a grant. */
async function rotatedPath(
  entry: PlannedRematerialization,
): Promise<Pick<
  ContainerWriterProjectionResponse,
  "containerKeks" | "path"
> | null> {
  const { plan } = entry.planned;
  if (!("keyring" in plan)) return null;
  return containerWriterProjectionFromRotationPlan({
    plan,
    previousProjection: entry.previousProjection,
  });
}

export async function preparePrincipalContainerRematerializationBatch(
  input: PrincipalContainerRematerializationInput,
): Promise<PreparedPrincipalContainerRematerializationBatch> {
  const entries = await buildPrincipalContainerRematerializationPlans(input);
  const plans = entries.map((entry) => entry.planned);
  const carriedPlans: MaterializedContainerRekeyPlan[] = [];
  return {
    plans,
    requests: plans.map((planned) => planned.plan.request),
    carry: async (requiredContainerIds) => {
      // Each rotation in the batch is a speculative ancestor a carried rekey
      // may sit below; the planner picks the deepest per container. The batch
      // is planned parent-first, so the server never names one of its own.
      const rotated = (
        await Promise.all(entries.map((entry) => rotatedPath(entry)))
      ).filter((path) => path !== null);
      const planned = await planCarriedDescendantRekeys({
        apiClient: input.apiClient,
        author: input.author,
        execSql: input.execSql,
        principalPolicyCache: seededPrincipalPolicyCache(input.nextPolicy),
        // Its path cites the policy this batch commits, so like every
        // rematerialized rotation it must cite the successor.
        replacementPrincipalPolicy: input.nextPolicy,
        requiredContainerIds,
        resolveProjectionUserKey: createProjectionUserKeyResolver({
          resolveTrustedUserIdentity: input.resolveTrustedUserIdentity,
        }),
        rotated,
        stillCurrent: input.stillCurrent,
        targetSecretKey: input.targetSecretKey,
        warmReferencedPrincipalPolicies: input.warmReferencedPrincipalPolicies,
      });
      carriedPlans.splice(0, carriedPlans.length, ...planned);
      return planned.map(({ plan }) => plan.request);
    },
    acknowledge: async (responses, stillCurrent) => {
      const isCurrent = () =>
        input.stillCurrent?.() !== false && stillCurrent?.() !== false;
      const acknowledged = await acknowledgeContainerMutationBatch({
        execSql: input.execSql,
        plans: [
          ...plans.map(authoredMutationHead),
          ...carriedPlans.map(({ plan }) => plan),
        ],
        responses,
        stillCurrent: isCurrent,
      });
      if (!acknowledged || !isCurrent()) return;
      const plansByOrganization = new Map<
        string,
        AuthoredContainerMutationHead[]
      >();
      for (const planned of [...plans, ...carriedPlans]) {
        const head = authoredMutationHead(planned);
        const organizationId = head.state.organizationId;
        const group = plansByOrganization.get(organizationId) ?? [];
        group.push(head);
        plansByOrganization.set(organizationId, group);
      }
      for (const [organizationId, organizationPlans] of plansByOrganization) {
        try {
          rememberVerifiedContainerHeads({
            organizationId,
            execSql: input.execSql,
            heads: [],
            policies: [input.nextPolicy],
          });
        } catch {
          // Cache failure must not invalidate the durably acknowledged batch.
          continue;
        }
        scheduleHeldDescendantRecitations({
          apiClient: input.apiClient,
          author: { ...input.author, organizationId },
          execSql: input.execSql,
          plans: organizationPlans,
          stillCurrent: isCurrent,
          reportSecurityIncident: input.reportSecurityIncident,
        });
      }
    },
  };
}
