import { computePrincipalStateHash } from "@tearleads/crypto";
import type { CommitOrganizationGroupPolicyRequest } from "@tearleads/validators/request";
import type { CommitOrganizationGroupPolicyResponse } from "@tearleads/validators/response";
import { canonicalKeyingJsonString } from "../../data/keyingCanonicalJson";
import { assertPrincipalPolicyReceiptArtifacts } from "./principalPolicyReceiptArtifacts";

/** A past commit acknowledgement is not evidence for advancing current pins. */
export async function assertAuthoredPrincipalMutationReceipt(
  request: CommitOrganizationGroupPolicyRequest,
  response: CommitOrganizationGroupPolicyResponse,
): Promise<void> {
  for (const part of ["groupPolicy", "organizationPolicy"] as const) {
    await assertAuthoredPrincipalPolicyReceipt(request[part], response[part]);
  }
}

export async function assertAuthoredPrincipalPolicyReceipt(
  expected: CommitOrganizationGroupPolicyRequest["groupPolicy"],
  observed: CommitOrganizationGroupPolicyResponse["groupPolicy"],
): Promise<void> {
  const { stateHash, createdAt: _createdAt, ...state } = observed.currentState;
  if (
    stateHash !== (await computePrincipalStateHash(expected.state)) ||
    canonicalKeyingJsonString(state, "principal mutation receipt state") !==
      canonicalKeyingJsonString(expected.state, "authored principal state")
  )
    throw new Error(
      "Principal mutation receipt state differs from the authored request",
    );
  assertPrincipalPolicyReceiptArtifacts({
    request: expected,
    response: observed,
    expectedHead: { ...observed.currentState, stateHash },
  });
}
