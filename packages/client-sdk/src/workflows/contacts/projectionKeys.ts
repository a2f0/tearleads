import {
  createProjectionUserKeyResolver,
  type ProjectionUserKeyResolver,
} from "../../data/keyingProjectionVerification";

export type ContactProjectionUserKeyResolver = ProjectionUserKeyResolver;
export type ContactProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export function createContactProjectionUserKeyResolver(
  runtime: ContactProjectionKeyRuntime,
): ContactProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(runtime, "Contacts");
}

export function didContactProjectionKeyRuntimeChange(
  previousRuntime: ContactProjectionKeyRuntime,
  nextRuntime: ContactProjectionKeyRuntime,
): boolean {
  return (
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.encapsulationKeyPair !== nextRuntime.encapsulationKeyPair ||
    previousRuntime.log !== nextRuntime.log ||
    previousRuntime.signingFingerprint !== nextRuntime.signingFingerprint ||
    previousRuntime.signingKeyPair !== nextRuntime.signingKeyPair ||
    previousRuntime.userId !== nextRuntime.userId
  );
}
