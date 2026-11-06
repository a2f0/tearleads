export type {
  PrincipalStateBundleInput,
  StoredPrincipalState,
} from "../shared/internal/principalStateRecords";
export { storeVerifiedPrincipalStateInTransaction } from "../shared/internal/principalStateStore";
export type { StoreVerifiedPrincipalStateOptions } from "../shared/internal/principalStateSuccession";
export {
  forgetPrincipalTransactionMemo,
  notePrincipalMutationLocked,
} from "../shared/internal/principalTransactionMemo";
