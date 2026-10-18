import type { VerifiedPrincipalPolicyCurrent } from "@tearleads/crypto";
import {
  type AcknowledgedPrincipalCurrentBatch,
  recordAcknowledgedPrincipalCurrents,
} from "../../principals/acknowledgements/acknowledgedPrincipalCurrents";
import type { PrincipalAcknowledgementChecks } from "../../principals/acknowledgements/principalAcknowledgementChecks";
import { acknowledgeGroupPolicyState } from "../groupPolicy/groupPolicyMutationAcknowledgement";
import { groupPolicyMutationHead } from "../groupPolicy/groupPolicyMutationHead";
import { assertPrincipalPolicyReceiptArtifacts } from "../principalPolicy/principalPolicyReceiptArtifacts";
import { assertAcknowledgedDirectoryBindings } from "./acknowledgedDirectoryBindings";

export type { AcknowledgedPrincipalCurrentRetirement } from "../../../data/persistence/principalCurrentAcknowledgementPersistence";
export type { AcknowledgedPrincipalCurrentInput } from "../../principals/acknowledgements/acknowledgedPrincipalCurrents";

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
