import type { VerifiedPrincipalPolicyCurrent } from "@tearleads/crypto";
import {
  type AcknowledgedPrincipalCurrentBatch,
  recordAcknowledgedPrincipalCurrents,
} from "../principals/acknowledgedPrincipalCurrents";
import type { PrincipalAcknowledgementChecks } from "../principals/principalAcknowledgementChecks";
import { assertAcknowledgedDirectoryBindings } from "./acknowledgedDirectoryBindings";
import { acknowledgeGroupPolicyState } from "./groupPolicyMutationAcknowledgement";
import { groupPolicyMutationHead } from "./groupPolicyMutationHead";
import { assertPrincipalPolicyReceiptArtifacts } from "./principalPolicyReceiptArtifacts";

export type { AcknowledgedPrincipalCurrentRetirement } from "../../data/persistence/principalCurrentAcknowledgementPersistence";
export type { AcknowledgedPrincipalCurrentInput } from "../principals/acknowledgedPrincipalCurrents";

/** How organization and group mutations check an acknowledgement they authored. */
const principalAcknowledgementChecks: PrincipalAcknowledgementChecks = {
  authoredHead: groupPolicyMutationHead,
  assertReceipt: assertPrincipalPolicyReceiptArtifacts,
  acknowledgeSuccessor: (input) => acknowledgeGroupPolicyState(input),
  assertDirectoryBindings: assertAcknowledgedDirectoryBindings,
};

/** Extend authenticated local progress and retain exact acknowledged artifacts atomically with pins. */
export function retainAcknowledgedPrincipalCurrents(
  input: AcknowledgedPrincipalCurrentBatch,
): Promise<VerifiedPrincipalPolicyCurrent[]> {
  return recordAcknowledgedPrincipalCurrents({
    ...input,
    checks: principalAcknowledgementChecks,
  });
}
