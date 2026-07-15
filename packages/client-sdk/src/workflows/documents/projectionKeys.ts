import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";

export type DocumentProjectionUserKeyResolver = ProjectionUserKeyResolver;
type ProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export interface DocumentProjectionKeyRuntime {
  readonly resolveTrustedUserIdentity: ProjectionKeyRuntime["resolveTrustedUserIdentity"];
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
    resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
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
    previousRuntime.resolveTrustedUserIdentity !==
    nextRuntime.resolveTrustedUserIdentity
  );
}
