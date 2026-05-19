import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";

export type DocumentProjectionUserKeyResolver = ProjectionUserKeyResolver;
export type DocumentProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export function createDocumentProjectionUserKeyResolver(
  runtime: DocumentProjectionKeyRuntime,
): DocumentProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(runtime, "Documents");
}

export function didDocumentProjectionKeyRuntimeChange(
  previousRuntime: DocumentProjectionKeyRuntime,
  nextRuntime: DocumentProjectionKeyRuntime,
): boolean {
  return (
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.encapsulationKeyPair !== nextRuntime.encapsulationKeyPair ||
    previousRuntime.signingFingerprint !== nextRuntime.signingFingerprint ||
    previousRuntime.signingKeyPair !== nextRuntime.signingKeyPair ||
    previousRuntime.userId !== nextRuntime.userId
  );
}
