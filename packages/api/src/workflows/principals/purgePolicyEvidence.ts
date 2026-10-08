import type { DatabaseSession } from "@tearleads/api-shared/postgres";
import {
  computePrincipalStatePayloadCiphertextHash,
  principalPolicyMatchesReference,
  type ReferencedPrincipalHead,
} from "@tearleads/crypto";
import type {
  AccessManifestBundleWireResponse,
  ProjectionPolicyEvidenceResponse,
} from "@tearleads/validators/response";
import { readExactPrincipalDirectoryBinding } from "../../access/read/principalDirectoryBindings";
import {
  getPrincipalStatePayloadForState,
  getPrincipalStatesForReferences,
  principalStateReferenceKey,
} from "../../access/read/principalStateStore";
import { canonicalJsonEquals } from "../../utils/canonicalJson";
import { parseOrganizationAuthorityDescriptor } from "../organizations/organizationAuthorityDescriptor";
import { principalHistoryHead } from "./principalHistoryRecords";
import { loadPrincipalPolicySelections } from "./principalPolicySelections";
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

async function loadBinding(input: {
  readonly executor: DatabaseSession;
  readonly organizationId: string;
  readonly head: ReferencedPrincipalHead;
}) {
  const row = await readExactPrincipalDirectoryBinding({
    executor: input.executor,
    organizationId: input.organizationId,
    groupId: input.head.principalId,
    groupStateHash: input.head.stateHash,
  });
  if (!row?.payloadCiphertextHash || row.groupVersion !== input.head.version)
    reject("Purge policy lacks its exact directory binding");
  const payload = await getPrincipalStatePayloadForState(
    "organization",
    input.organizationId,
    row.organizationStateHash,
    input.executor,
  );
  if (
    !payload ||
    (await computePrincipalStatePayloadCiphertextHash(payload.ciphertext)) !==
      row.payloadCiphertextHash ||
    payload.ciphertextHash !== row.payloadCiphertextHash
  )
    reject("Purge directory payload hash differs");
  const directory = parseOrganizationAuthorityDescriptor(payload.ciphertext);
  if (
    !directory ||
    directory.organizationId !== input.organizationId ||
    !directory.groupHeads.some((candidate) =>
      canonicalJsonEquals(candidate, input.head),
    )
  )
    reject("Purge group differs from its signed directory binding");
  const admin = directory.groupHeads.find(
    (candidate) => candidate.principalId === directory.adminGroupId,
  );
  if (!admin) reject("Purge directory omits its Admins head");
  const state = (
    await getPrincipalStatesForReferences(
      [
        {
          principalType: "organization",
          principalId: input.organizationId,
          stateHash: row.organizationStateHash,
        },
      ],
      input.executor,
    )
  ).get(
    principalStateReferenceKey({
      principalType: "organization",
      principalId: input.organizationId,
      stateHash: row.organizationStateHash,
    }),
  );
  if (!state || state.version !== row.organizationVersion)
    reject("Purge directory state is missing");
  return {
    admin,
    binding: {
      reference: principalHistoryHead(state),
      payload: toPrincipalStatePayloadResponse(payload),
    },
  };
}

/** Terminal evidence ends at cited heads and their first signed directory bindings. */
export async function loadPurgePolicyEvidence(input: {
  readonly executor: DatabaseSession;
  readonly scope: ProjectionPolicyHistoryScope;
  readonly bundles: readonly AccessManifestBundleWireResponse[];
}): Promise<ProjectionPolicyEvidenceResponse> {
  const references = projectionPolicyReferences(
    input.bundles,
    input.scope.organizationId,
  );
  if (!references.length)
    return { organization: null, organizationPayloads: [], groups: [] };
  const groups = new Map<string, ReferencedPrincipalHead>();
  const pending: ReferencedPrincipalHead[] = [];
  const addGroup = (head: ReferencedPrincipalHead) => {
    if (head.principalType !== "group")
      reject("Purge directory contains a non-group source");
    const prior = groups.get(head.principalId);
    if (prior?.version === head.version && !canonicalJsonEquals(prior, head))
      reject("Purge directory group heads equivocate");
    if (!prior || head.version > prior.version) {
      groups.set(head.principalId, head);
      pending.push(head);
    }
  };
  for (const reference of references)
    if (reference.principalType === "group") addGroup(reference);
  const payloads = new Map<
    string,
    ProjectionPolicyEvidenceResponse["organizationPayloads"][number]
  >();
  for (let index = 0; index < pending.length; index++) {
    const head = pending[index];
    if (!head) throw new Error("Missing queued purge policy head");
    const { admin, binding } = await loadBinding({
      executor: input.executor,
      organizationId: input.scope.organizationId,
      head,
    });
    addGroup(admin);
    payloads.set(binding.reference.stateHash, binding);
  }
  const organizationHeads = [...payloads.values()]
    .map(({ reference }) => reference)
    .concat(references.filter((head) => head.principalType === "organization"));
  const organization = organizationHeads.reduce<ReferencedPrincipalHead | null>(
    (latest, head) =>
      !latest || head.version > latest.version ? head : latest,
    null,
  );
  if (!organization) reject("Purge policy has no organization binding");
  const required = [...references, ...groups.values(), ...organizationHeads];
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
      reject("Purge policy citation lacks verified inclusion");
  const source = (head: ReferencedPrincipalHead) => ({
    head: principalHistoryHead(head),
    grant: issueProjectionPolicyHistoryGrant({ ...input.scope, head }),
  });
  return {
    organization: source(organization),
    organizationPayloads: [...payloads.values()],
    groups: [...groups.values()].map(source),
  };
}
