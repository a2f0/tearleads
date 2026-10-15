export { createApiUserIdentitySource } from "./apiAdapter";
export { requireTrustedUserIdentityResolver } from "./requiredResolver";
export { createTrustedUserIdentityService } from "./service";
export { resolveIdentityTrustDomain } from "./trustDomain";
export type {
  LocalUserIdentityCandidate,
  TrustedUserIdentity,
  TrustedUserIdentityResolver,
  TrustedUserIdentityService,
} from "./types";
export { validateUserIdentityKeys } from "./validation";
