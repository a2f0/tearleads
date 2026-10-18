export type { PrincipalHistoryProtectionLease } from "../../data/principals/principalHistoryProtection";
export {
  type AcknowledgedPrincipalPredecessor,
  captureAcknowledgedPrincipalPredecessor,
} from "./acknowledgements/acknowledgedPrincipalPredecessor";
export {
  PrincipalPolicyHistoryReadError,
  type RecoveredPrincipalPolicyHistory,
  type RecoverPrincipalPolicyHistoryOptions,
} from "./historyRecovery/principalHistoryRecoveryTypes";
export { recoverPrincipalPolicyHistory } from "./historyRecovery/recoverPrincipalPolicyHistory";
export {
  type RecoveredScopedPrincipalPolicyHistory,
  type RecoverScopedPrincipalPolicyHistoryOptions,
  recoverScopedPrincipalPolicyHistory,
} from "./historyRecovery/recoverScopedPrincipalPolicyHistory";
export {
  type CachePrincipalPolicyBundlesOptions,
  type CacheReferencedPrincipalPoliciesOptions,
  cachePrincipalPolicyBundles,
  cacheReferencedPrincipalPolicies,
} from "./policyCache";
export {
  type ProjectionPolicyHistoryRecoveryOptions,
  recoverProjectionPolicyHistory,
} from "./publicHistory/recoverProjectionPolicyHistory";
