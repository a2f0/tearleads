import type { PrincipalPolicyPageCurrent } from "@tearleads/api-client";
import type {
  PrincipalPolicyExternalAuthority,
  PrincipalPolicySignerPublicKey,
  ReferencedPrincipalHead,
  VerifiedPrincipalPolicyCurrent,
} from "@tearleads/crypto";
import type { PutPrincipalPolicyRequest } from "@tearleads/validators/request";
import type { PrincipalPolicyMutationResponse } from "@tearleads/validators/response";

/**
 * The checks the code that authored a principal mutation makes on the
 * server's acknowledgement of it. Recovery records an acknowledged current
 * only after these accept it; the organization mutation workflows supply them.
 */
export interface PrincipalAcknowledgementChecks {
  /** The head an authored request commits to. */
  readonly authoredHead: (
    request: PutPrincipalPolicyRequest,
  ) => Promise<ReferencedPrincipalHead>;
  /**
   * The receipt names the authored head; the current it commits is rebuilt
   * from the authored request and the server-assigned fields.
   */
  readonly acknowledgedCurrent: (input: {
    readonly request: PutPrincipalPolicyRequest;
    readonly response: PrincipalPolicyMutationResponse;
  }) => Promise<PrincipalPolicyPageCurrent>;
  /** The acknowledged state is the authored successor of the verified predecessor. */
  readonly acknowledgeSuccessor: (input: {
    readonly verifiedCurrentPolicy: VerifiedPrincipalPolicyCurrent;
    readonly expectedHead: ReferencedPrincipalHead;
    readonly request: PutPrincipalPolicyRequest;
    readonly response: PrincipalPolicyPageCurrent["currentState"];
    readonly signerPublicKeys: readonly PrincipalPolicySignerPublicKey[];
    readonly externalAuthority?: PrincipalPolicyExternalAuthority | undefined;
    readonly stillCurrent: () => boolean;
  }) => Promise<VerifiedPrincipalPolicyCurrent>;
  /** Acknowledged directory and group heads cite each other. */
  readonly assertDirectoryBindings: (
    organizationId: string,
    currents: readonly PrincipalPolicyPageCurrent[],
  ) => void;
}
