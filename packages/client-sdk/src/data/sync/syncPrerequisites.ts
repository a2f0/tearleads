export interface SyncRuntimeStatus {
  crypto: { encapsulationKeyPair: unknown };
  auth: { isAuthenticated: boolean };
  state: { online: boolean };
}

export function didRegainSyncPrerequisites<TRuntime extends SyncRuntimeStatus>(
  previousRuntime: TRuntime,
  nextRuntime: TRuntime,
): boolean {
  return (
    (!previousRuntime.state.online && nextRuntime.state.online) ||
    (!previousRuntime.auth.isAuthenticated &&
      nextRuntime.auth.isAuthenticated) ||
    (!previousRuntime.crypto.encapsulationKeyPair &&
      !!nextRuntime.crypto.encapsulationKeyPair)
  );
}
