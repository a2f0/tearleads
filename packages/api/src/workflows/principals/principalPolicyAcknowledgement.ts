import type {
  ContainerMutationResponse,
  PrincipalPolicyMutationResponse,
} from "@tearleads/validators/response";
import type { StoredPrincipalState } from "../../access/read/principalStateStore";
import { principalHistoryHead } from "./principalHistoryRecords";

/**
 * Acknowledge a stored state by its head. The author already holds every signed
 * byte, so only the head and the server-assigned insertion time go back; the
 * state's payload row is stored with that same time.
 */
export function toPrincipalPolicyMutationResponse(
  state: Pick<
    StoredPrincipalState,
    | "principalType"
    | "principalId"
    | "version"
    | "keyEpoch"
    | "stateHash"
    | "keyFingerprint"
    | "createdAt"
  >,
  containerMutations: ContainerMutationResponse[],
): PrincipalPolicyMutationResponse {
  return {
    head: principalHistoryHead(state),
    createdAt: state.createdAt.toISOString(),
    containerMutations,
  };
}
