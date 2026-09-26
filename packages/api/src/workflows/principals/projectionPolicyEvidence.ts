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

type DirectoryPayload = NonNullable<
  Awaited<ReturnType<typeof listOrganizationHistoryPayloads>>
>[number];

function directoryBindings(
  payloads: readonly DirectoryPayload[],
  organizationId: string,
  neededGroups: ReadonlySet<string>,
) {
  // Include the retained chain through the last directory-bound head. A reader
  // may have checkpointed a successor after the projection's frozen citation.
  const latest = new Map<string, ReferencedPrincipalHead>();
  const bindingPayloadByGroupState = new Map<string, DirectoryPayload>();
  for (const payload of payloads) {
    const directory = parseOrganizationAuthorityDescriptor(payload.ciphertext);
    if (!directory || directory.organizationId !== organizationId)
      throw new PrincipalPolicyError(
        "Projection directory organization mismatch",
        409,
      );
    for (const head of directory.groupHeads) {
      if (
        neededGroups.has(head.principalId) ||
        head.principalId === directory.adminGroupId
      ) {
        latest.set(head.principalId, head);
        bindingPayloadByGroupState.set(head.stateHash, payload);
      }
    }
  }
  return { latest, bindingPayloadByGroupState };
}

function projectionPolicyReferences(
  bundles: readonly AccessManifestBundleWireResponse[],
  organizationId: string,
): ReferencedPrincipalHead[] {
  const references: ReferencedPrincipalHead[] = [];
  for (const bundle of bundles) {
    const manifest = readProjectionAccessManifest(
      bundle.manifest,
      "Projection policy evidence manifest",
      (message) => new PrincipalPolicyError(message, 409),
    );
    if (manifest.organizationId !== organizationId)
      throw new PrincipalPolicyError(
        "Projection policy organization mismatch",
        409,
      );
    references.push(...manifest.referencedPrincipalHeads);
  }
  return references;
}

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
  const { latest, bindingPayloadByGroupState } = directoryBindings(
    payloads,
    input.organizationId,
    neededGroups,
  );
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
  const groups = snapshots.filter(
    (snapshot) => snapshot.currentState.principalType === "group",
  );
  const bindings = new Map<string, (typeof payloads)[number]>();
  for (const group of groups) {
    const payload = bindingPayloadByGroupState.get(
      group.currentState.stateHash,
    );
    if (!payload)
      throw new PrincipalPolicyError(
        "Projection group directory binding missing",
        409,
      );
    bindings.set(payload.stateHash, payload);
  }
  return {
    organization: organizationSnapshot,
    organizationPayloads: [...bindings.values()].map(
      toPrincipalStatePayloadResponse,
    ),
    groups,
  };
}
