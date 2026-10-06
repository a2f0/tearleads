import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type {
  AccessManifestBundleWireResponse,
  PrincipalPolicySnapshotResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { loadVerifiedPrincipalPolicySnapshotsForReferences } from "./principalPolicySnapshots";
import { loadProjectionDirectoryBindings } from "./projectionDirectoryBindings";
import { projectionPolicyReferences } from "./projectionPolicyReferences";
import {
  PrincipalPolicyError,
  toPrincipalStatePayloadResponse,
} from "./shared";

/** Call only after authorizing the projection. This carries no group secrets. */
export async function loadProjectionPolicyEvidence(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly bundles: readonly AccessManifestBundleWireResponse[];
}): Promise<ProjectionPolicyEvidenceResponse> {
  const references = projectionPolicyReferences(
    input.bundles,
    input.organizationId,
  );
  if (references.length === 0)
    return { organization: null, organizationPayloads: [], groups: [] };
  const organization = await getCurrentPrincipalState(
    "organization",
    input.organizationId,
    input.executor,
  );
  if (!organization)
    throw new PrincipalPolicyError(
      "Projection organization policy missing",
      409,
    );
  references.push(organization);
  const neededGroups = new Set(
    references
      .filter((reference) => reference.principalType === "group")
      .map((reference) => reference.principalId),
  );
  const { latest, adminGroupIds, bindingPayloadByGroupState } =
    await loadProjectionDirectoryBindings({
      executor: input.executor,
      organization,
      groupIds: [...neededGroups],
    });
  references.push(
    ...[...latest.values()].filter(
      (head) =>
        neededGroups.has(head.principalId) ||
        adminGroupIds.has(head.principalId),
    ),
  );
  const { snapshots } = await loadVerifiedPrincipalPolicySnapshotsForReferences(
    input.executor,
    references,
  );
  return bindProjectionPolicySnapshots(snapshots, bindingPayloadByGroupState);
}

function bindProjectionPolicySnapshots(
  snapshots: readonly PrincipalPolicySnapshotResponse[],
  bindingPayloadByGroupState: Awaited<
    ReturnType<typeof loadProjectionDirectoryBindings>
  >["bindingPayloadByGroupState"],
): ProjectionPolicyEvidenceResponse {
  const organizationSnapshot = snapshots.find(
    (snapshot) => snapshot.currentState.principalType === "organization",
  );
  if (!organizationSnapshot)
    throw new PrincipalPolicyError(
      "Projection organization snapshot missing",
      409,
    );
  const groups = snapshots.filter(
    (snapshot) => snapshot.currentState.principalType === "group",
  );
  const bindings = new Map<
    string,
    ProjectionPolicyEvidenceResponse["organizationPayloads"][number]
  >();
  for (const group of groups) {
    const payload = bindingPayloadByGroupState.get(
      group.currentState.stateHash,
    );
    if (!payload)
      throw new PrincipalPolicyError(
        "Projection group directory binding missing",
        409,
      );
    bindings.set(payload.stateHash, toPrincipalStatePayloadResponse(payload));
  }
  return {
    organization: organizationSnapshot,
    organizationPayloads: [...bindings.values()],
    groups,
  };
}
