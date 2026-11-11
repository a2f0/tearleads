import type {
  ContainerAccessLevel,
  ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type { PrincipalPolicyBundleResponse } from "@tearleads/validators/response";
import { runWithSecurityIncidentReporting } from "../../data/keyingProjectionVerification/error";
import { principalHeadMatchesReference } from "../../data/principals/organizationAuthorityDescriptor";
import type { SecurityIncidentReporter } from "../../data/shared/securityIncidents";
import type { ExecSql } from "../../data/sqlite/sqlSchema";
import { DatabaseUnavailableError } from "../../data/sync/databaseUnavailable";
import { UnverifiedUserIdentityError } from "../../data/trustedUserIdentity";
import {
  isRosterVouchedRecipient,
  type RosterAdmissionEvidence,
} from "../../workflows/organizations/memberships/rosterVouchedAdmission";
import type { InternalRuntime } from "../runtime/workflowRuntime";
import { currentOrganizationMutation } from "./principalMutationScope";
import { createRosterAdmissionEvidence } from "./rosterAdmissionEvidence";

export { loadServedStateEnvelopes } from "./rosterAdmissionEvidence";

type AdmissionRuntimeService = Pick<
  InternalRuntime,
  "identityLinks" | "sessionGeneration" | "workflowInput"
>;

/**
 * Whether the signed roster vouches for `userId` on this device. First sight
 * pins the keys the server serves as observed, and the roster must then vouch
 * for exactly that domain-scoped signing and encapsulation identity bundle.
 * Served material that fails verification is
 * recorded as a security incident before the error propagates.
 */
export function isReportedRosterVouchedRecipient(input: {
  readonly evidence: RosterAdmissionEvidence;
  readonly organizationId: string;
  readonly reportSecurityIncident: SecurityIncidentReporter;
  readonly resolveTrustedUserIdentity: (userId: string) => Promise<unknown>;
  readonly userId: string;
}): Promise<boolean> {
  const { evidence, userId } = input;
  return runWithSecurityIncidentReporting(
    input.reportSecurityIncident,
    {
      objectId: userId,
      objectKind: "user",
      operation: "container.share.roster_vouch",
      organizationId: input.organizationId,
    },
    async () =>
      Boolean(await input.resolveTrustedUserIdentity(userId)) &&
      isRosterVouchedRecipient(userId, evidence),
  );
}

type RecipientAdmission =
  | { readonly status: "verified" }
  | { readonly status: "roster"; readonly head: ReferencedPrincipalHead };

async function requireOrganizationRecipient(
  service: AdmissionRuntimeService,
  admittingExecSql: ExecSql,
  userId: string,
): Promise<RecipientAdmission> {
  try {
    await service.identityLinks.requireVerified(userId, admittingExecSql);
    return { status: "verified" };
  } catch (error) {
    const runtime = service.workflowInput();
    const organizationId = runtime.auth.organizationId;
    if (!(error instanceof UnverifiedUserIdentityError) || !organizationId)
      throw error;
    const evidence = createRosterAdmissionEvidence(
      service,
      admittingExecSql,
      organizationId,
    );
    if (!evidence) throw error;
    let head: ReferencedPrincipalHead | undefined;
    const vouched = await isReportedRosterVouchedRecipient({
      evidence: {
        ...evidence,
        async loadCurrentMembers() {
          const members = await evidence.loadCurrentMembers();
          head = members.head;
          return members;
        },
      },
      organizationId,
      reportSecurityIncident: runtime.util.reportSecurityIncident,
      resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
      userId,
    });
    if (!vouched || !head) throw error;
    return { status: "roster", head };
  }
}

function admissionLifetime(service: AdmissionRuntimeService, execSql: ExecSql) {
  const scope = currentOrganizationMutation(service);
  return () => {
    if (scope.runtime.infra.execSql !== execSql || !scope.stillCurrent())
      throw new DatabaseUnavailableError(
        "The active identity or database changed while admitting this user. Try again.",
      );
  };
}

/** Full-bundle roster authentication admits read, write, and admin shares. */
export async function requireShareRecipient(
  service: AdmissionRuntimeService,
  admittingExecSql: ExecSql,
  userId: string,
  _accessLevel: ContainerAccessLevel,
): Promise<void> {
  const assertCurrent = admissionLifetime(service, admittingExecSql);
  assertCurrent();
  await requireOrganizationRecipient(service, admittingExecSql, userId);
  assertCurrent();
}

export type GroupMemberAdmission = (
  members: Pick<
    PrincipalPolicyBundleResponse,
    "currentState" | "currentProjection"
  >,
) => Promise<void>;

/** The proof is usable only at its exact Members head, within this runtime. */
export async function requireGroupMemberAdmission(
  service: AdmissionRuntimeService,
  admittingExecSql: ExecSql,
  userId: string,
): Promise<GroupMemberAdmission> {
  const assertCurrent = admissionLifetime(service, admittingExecSql);
  assertCurrent();
  const admission = await requireOrganizationRecipient(
    service,
    admittingExecSql,
    userId,
  );
  assertCurrent();
  return async (members) => {
    assertCurrent();
    if (!members.currentProjection.some((member) => member.userId === userId)) {
      // A retry may find the user removed since the proof. Enrollment still
      // requires this device's self/link anchor, never an earlier roster proof.
      await service.identityLinks.requireVerified(userId, admittingExecSql);
    } else if (
      admission.status === "roster" &&
      !principalHeadMatchesReference(members.currentState, admission.head)
    ) {
      throw new UnverifiedUserIdentityError(userId);
    }
    assertCurrent();
  };
}

/** Capture the mutation scope before obtaining its head-bound admission proof. */
export async function admitGroupMutation(
  service: AdmissionRuntimeService,
  userId: string,
) {
  const mutation = currentOrganizationMutation(service);
  const admission = await requireGroupMemberAdmission(
    service,
    mutation.runtime.infra.execSql,
    userId,
  );
  if (!mutation.stillCurrent())
    throw new DatabaseUnavailableError(
      "The active database changed while admitting this user. Try again.",
    );
  return { ...mutation, admission };
}
