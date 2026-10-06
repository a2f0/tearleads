import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  principalPolicyMatchesReference,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ProjectionPolicyHistoryEvidenceResponse,
} from "@tearleads/validators/response";
import {
  getCurrentPrincipalState,
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { principalHistoryHead } from "./principalHistoryRecords";
import { loadPrincipalPolicySelections } from "./principalPolicySelections";
import { loadProjectionDirectoryBindings } from "./projectionDirectoryBindings";
import {
  issueProjectionPolicyHistoryGrant,
  type ProjectionPolicyHistoryScope,
} from "./projectionPolicyHistoryGrant";
import { projectionPolicyReferences } from "./projectionPolicyReferences";
import {
  PrincipalPolicyError,
  toPrincipalStatePayloadResponse,
} from "./shared";

function reject(message: string): never {
  throw new PrincipalPolicyError(message, 409);
}

function identity(head: ReferencedPrincipalHead): string {
  return `${head.principalType}:${head.principalId}`;
}

async function loadBindingPayloads(
  executor: DatabaseSession,
  organization: ReferencedPrincipalHead,
  bindings: Awaited<ReturnType<typeof loadProjectionDirectoryBindings>>,
): Promise<ProjectionPolicyHistoryEvidenceResponse["organizationPayloads"]> {
  const payloads = new Map(
    [...bindings.latest.values()].map((head) => {
      const payload = bindings.bindingPayloadByGroupState.get(head.stateHash);
      if (!payload) reject("Projection group directory binding missing");
      return [payload.stateHash, payload] as const;
    }),
  );
  const payloadStates = await getPrincipalStatesForReferences(
    [...payloads.values()],
    executor,
  );
  return [...payloads.values()].map((payload) => {
    const state = payloadStates.get(principalStateReferenceKey(payload));
    if (
      state?.principalType !== "organization" ||
      state.principalId !== organization.principalId ||
      state.version > organization.version
    )
      reject("Projection directory payload state is outside its organization");
    return {
      reference: principalHistoryHead(state),
      payload: toPrincipalStatePayloadResponse(payload),
    };
  });
}

/** Call after object access verification; grants never confer verification trust. */
export async function loadProjectionPolicySources(input: {
  readonly executor: DatabaseSession;
  readonly scope: ProjectionPolicyHistoryScope;
  readonly bundles: readonly AccessManifestBundleWireResponse[];
}): Promise<ProjectionPolicyHistoryEvidenceResponse> {
  const { organizationId } = input.scope;
  const references = projectionPolicyReferences(input.bundles, organizationId);
  if (references.length === 0)
    return { organization: null, organizationPayloads: [], groups: [] };
  const organization = await getCurrentPrincipalState(
    "organization",
    organizationId,
    input.executor,
  );
  if (!organization) reject("Projection organization policy missing");
  const bindings = await loadProjectionDirectoryBindings({
    executor: input.executor,
    organization,
    groupIds: references
      .filter((reference) => reference.principalType === "group")
      .map((reference) => reference.principalId),
  });
  const heads = [organization, ...bindings.latest.values()];
  const byPrincipal = new Map(heads.map((head) => [identity(head), head]));
  for (const reference of references) {
    const bound = byPrincipal.get(identity(reference));
    if (!bound || reference.version > bound.version)
      reject("Projection citation exceeds its signed directory head");
  }
  const organizationPayloads = await loadBindingPayloads(
    input.executor,
    organization,
    bindings,
  );
  const required = [
    ...references,
    ...heads,
    ...organizationPayloads.map(({ reference }) => reference),
  ];
  const selections = await loadPrincipalPolicySelections(
    input.executor,
    required,
  );
  for (const reference of required)
    if (
      !selections.some((policy) =>
        principalPolicyMatchesReference({ policy, reference }),
      )
    )
      reject("Projection policy citation lacks verified inclusion");
  const source = (head: ReferencedPrincipalHead) => ({
    head: principalHistoryHead(head),
    grant: issueProjectionPolicyHistoryGrant({ ...input.scope, head }),
  });
  return {
    organization: source(organization),
    organizationPayloads,
    groups: [...bindings.latest.values()].map(source),
  };
}
