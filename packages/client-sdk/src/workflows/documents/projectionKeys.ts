import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";

export type DocumentProjectionUserKeyResolver = ProjectionUserKeyResolver;
type ProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export interface DocumentProjectionKeyRuntime {
  readonly apiClient: ProjectionKeyRuntime["apiClient"];
  readonly auth: {
    readonly userId?: string | null | undefined;
  };
  readonly crypto: {
    readonly encapsulationKeyPair?: ProjectionKeyRuntime["encapsulationKeyPair"];
    readonly signingFingerprint?: ProjectionKeyRuntime["signingFingerprint"];
    readonly signingKeyPair?: ProjectionKeyRuntime["signingKeyPair"];
  };
  readonly util?: {
    readonly log?: ProjectionKeyRuntime["log"];
  };
}

type DocumentProjectionRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

function documentProjectionRuntime(
  runtime: DocumentProjectionKeyRuntime,
): DocumentProjectionRuntime {
  const projectionRuntime: DocumentProjectionRuntime = {
    apiClient: runtime.apiClient,
    encapsulationKeyPair: runtime.crypto.encapsulationKeyPair ?? null,
    signingFingerprint: runtime.crypto.signingFingerprint ?? null,
    signingKeyPair: runtime.crypto.signingKeyPair ?? null,
    userId: runtime.auth.userId ?? null,
  };

  return runtime.util?.log
    ? { ...projectionRuntime, log: runtime.util.log }
    : projectionRuntime;
}

export function createDocumentProjectionUserKeyResolver(
  runtime: DocumentProjectionKeyRuntime,
): DocumentProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(
    documentProjectionRuntime(runtime),
    "Documents",
  );
}

export function didDocumentProjectionKeyRuntimeChange(
  previousRuntime: DocumentProjectionKeyRuntime,
  nextRuntime: DocumentProjectionKeyRuntime,
): boolean {
  return (
    previousRuntime.apiClient !== nextRuntime.apiClient ||
    previousRuntime.crypto.encapsulationKeyPair !==
      nextRuntime.crypto.encapsulationKeyPair ||
    previousRuntime.crypto.signingFingerprint !==
      nextRuntime.crypto.signingFingerprint ||
    previousRuntime.crypto.signingKeyPair !==
      nextRuntime.crypto.signingKeyPair ||
    previousRuntime.auth.userId !== nextRuntime.auth.userId
  );
}
