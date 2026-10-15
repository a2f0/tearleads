export { createApiUserIdentitySource } from "./apiAdapter";
export { requireTrustedUserIdentityResolver } from "./requiredResolver";
export {
  createTrustedUserIdentityService,
  loadPinnedUserIdentity,
} from "./service";
export { resolveIdentityTrustDomain } from "./trustDomain";
export type {
  LocalUserIdentityCandidate,
  TrustedUserIdentity,
  TrustedUserIdentityResolver,
} from "./types";
export { validateUserIdentityKeys } from "./validation";
