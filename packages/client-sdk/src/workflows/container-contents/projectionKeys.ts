import type { ProjectionUserKeyResolver } from "../../data/keyingProjectionVerification";
import { createProjectionUserKeyResolver } from "../../data/keyingProjectionVerification/userKeyResolver";

export type ContainerContentsProjectionUserKeyResolver =
  ProjectionUserKeyResolver;
type ProjectionKeyRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

export interface ContainerContentsProjectionKeyRuntime {
  readonly resolveTrustedUserIdentity: ProjectionKeyRuntime["resolveTrustedUserIdentity"];
  readonly util?: {
    readonly log?: ProjectionKeyRuntime["log"];
  };
}

type ContainerContentsProjectionRuntime = Parameters<
  typeof createProjectionUserKeyResolver
>[0];

function containerContentsProjectionRuntime(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionRuntime {
  const projectionRuntime: ContainerContentsProjectionRuntime = {
    resolveTrustedUserIdentity: runtime.resolveTrustedUserIdentity,
  };

  return runtime.util?.log
    ? { ...projectionRuntime, log: runtime.util.log }
    : projectionRuntime;
}

export function createContainerContentsProjectionUserKeyResolver(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(
    containerContentsProjectionRuntime(runtime),
    "Container contents",
  );
}

export function createContainerContentsDocumentProjectionUserKeyResolver(
  runtime: ContainerContentsProjectionKeyRuntime,
): ContainerContentsProjectionUserKeyResolver {
  return createProjectionUserKeyResolver(
    containerContentsProjectionRuntime(runtime),
    "Container document projections",
  );
}

export function didContainerContentsProjectionKeyRuntimeChange(
  previousRuntime: ContainerContentsProjectionKeyRuntime,
  nextRuntime: ContainerContentsProjectionKeyRuntime,
): boolean {
  return (
    previousRuntime.resolveTrustedUserIdentity !==
    nextRuntime.resolveTrustedUserIdentity
  );
}
