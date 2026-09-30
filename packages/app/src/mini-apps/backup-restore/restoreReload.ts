/**
 * The post-restore reload: keep the session's root acknowledgements (#2365
 * finding 24), then clear the caches that pin the old root, then reload. The
 * reload happens even if keeping the acknowledgements failed.
 */
export async function reloadAfterRestore(input: {
  readonly clearCaches: () => void;
  readonly logError: (message: string, error: unknown) => void;
  readonly prepare: () => Promise<void>;
  readonly reload: () => void;
}): Promise<void> {
  try {
    await input.prepare();
  } catch (error) {
    input.logError(
      "Failed to keep the session's root acknowledgements across restore",
      error,
    );
  }
  input.clearCaches();
  input.reload();
}
