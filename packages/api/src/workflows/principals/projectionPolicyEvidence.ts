import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import type { ReferencedPrincipalHead } from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import { listOrganizationHistoryPayloads } from "../../access/read/principalHistory";
import { getCurrentPrincipalState } from "../../access/read/principalStateStore";
import { readProjectionAccessManifest } from "../../keyingProjectionRecords";
import { parseOrganizationAuthorityDescriptor } from "../organizations/organizationAuthorityDescriptor";
import { loadVerifiedPrincipalPolicySnapshotsForReferences } from "./principalPolicySnapshots";
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
  const references: ReferencedPrincipalHead[] = [organization];
  for (const bundle of input.bundles) {
    const manifest = readProjectionAccessManifest(
      bundle.manifest,
      "Projection policy evidence manifest",
      (message) => new PrincipalPolicyError(message, 409),
    );
    if (manifest.organizationId !== input.organizationId)
      throw new PrincipalPolicyError(
        "Projection policy organization mismatch",
        409,
      );
    references.push(...manifest.referencedPrincipalHeads);
  }
  const payloads = await listOrganizationHistoryPayloads(
    input.executor,
    input.organizationId,
    organization.stateHash,
  );
  if (!payloads)
    throw new PrincipalPolicyError("Projection directory history missing", 409);
  const neededGroups = new Set(
    references
      .filter((reference) => reference.principalType === "group")
      .map((reference) => reference.principalId),
  );
  // Include the retained chain through the last directory-bound head. A reader
  // may have checkpointed a successor after the projection's frozen citation.
  const latest = new Map<string, ReferencedPrincipalHead>();
  for (const payload of payloads) {
    const directory = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (!directory || directory.organizationId !== input.organizationId)
      throw new PrincipalPolicyError(
        "Projection directory organization mismatch",
        409,
      );
    for (const head of directory.groupHeads) {
      if (
        neededGroups.has(head.principalId) ||
        head.principalId === directory.adminGroupId
      )
        latest.set(head.principalId, head);
    }
  }
  references.push(...latest.values());
  const { snapshots } = await loadVerifiedPrincipalPolicySnapshotsForReferences(
    input.executor,
    references,
  );
  const organizationSnapshot = snapshots.find(
    (snapshot) => snapshot.currentState.principalType === "organization",
  );
  if (!organizationSnapshot)
    throw new PrincipalPolicyError(
      "Projection organization snapshot missing",
      409,
    );
  return {
    organization: organizationSnapshot,
    organizationPayloads: payloads.map(toPrincipalStatePayloadResponse),
    groups: snapshots.filter(
      (snapshot) => snapshot.currentState.principalType === "group",
    ),
  };
}
