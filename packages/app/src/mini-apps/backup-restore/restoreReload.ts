import type { RestoreReloadDrop } from "../../providers/crypto/usePrepareForRestoreReload";

/**
 * The post-restore reload: keep the session's root acknowledgements (#2365
 * finding 24), then clear the caches that pin the old root, then reload. The
 * reload happens even if keeping the acknowledgements failed, and a dropped
 * record is logged with its reason.
 */
export async function reloadAfterRestore(input: {
  readonly clearCaches: () => void;
  readonly logError: (message: string, error: unknown) => void;
  readonly prepare: () => Promise<RestoreReloadDrop>;
  readonly reload: () => void;
}): Promise<void> {
  try {
    const dropped = await input.prepare();
    if (dropped !== null) {
      input.logError(
        "The session record was dropped across restore, losing its root acknowledgements",
        dropped,
      );
    }
  } catch (error) {
    input.logError(
      "Failed to keep the session's root acknowledgements across restore",
      error,
    );
  }
  input.clearCaches();
  input.reload();
}
