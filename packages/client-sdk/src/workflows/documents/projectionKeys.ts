import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";
import type {
  WorkflowRuntimeAuthInput,
  WorkflowRuntimeCryptoInput,
  WorkflowRuntimeStateInput,
} from "../runtimeInput";

export type DocumentProjectionUserKeyResolver = ProjectionUserKeyResolver;
type ProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export interface DocumentProjectionKeyRuntime {
  readonly auth: Pick<WorkflowRuntimeAuthInput, "isAuthenticated" | "userId">;
  readonly crypto: WorkflowRuntimeCryptoInput;
  readonly resolveTrustedUserIdentity: ProjectionKeyRuntime["resolveTrustedUserIdentity"];
  readonly state: Pick<WorkflowRuntimeStateInput, "domainScope">;
}

export function createDocumentProjectionUserKeyResolver(
  runtime: DocumentProjectionKeyRuntime,
): DocumentProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(runtime);
}

export function didDocumentProjectionKeyRuntimeChange(
  previousRuntime: DocumentProjectionKeyRuntime,
  nextRuntime: DocumentProjectionKeyRuntime,
): boolean {
  // The SDK-owned resolver is stable for the lifetime of Tearleads, but reads
  // mutable session, identity, and database dependencies. The projection
  // resolver adds its own per-user cache, so compare that trust context rather
  // than relying only on the resolver function reference.
  return (
    previousRuntime.resolveTrustedUserIdentity !==
      nextRuntime.resolveTrustedUserIdentity ||
    previousRuntime.auth.isAuthenticated !== nextRuntime.auth.isAuthenticated ||
    previousRuntime.auth.userId !== nextRuntime.auth.userId ||
    previousRuntime.crypto.encapsulationKeyPair !==
      nextRuntime.crypto.encapsulationKeyPair ||
    previousRuntime.crypto.signingFingerprint !==
      nextRuntime.crypto.signingFingerprint ||
    previousRuntime.crypto.signingKeyPair !==
      nextRuntime.crypto.signingKeyPair ||
    previousRuntime.state.domainScope !== nextRuntime.state.domainScope
  );
}
