/** One seed command owns the process and its in-memory database. */
export async function runSeedCommandWithDeadline(
  run: (
    registerShutdown: (revoke: () => Promise<boolean>) => void,
  ) => Promise<number>,
  report: (message: string) => void,
  timeoutMs = 65 * 60_000,
  graceMs = 5_000,
): Promise<number> {
  const stopped = Promise.withResolvers<string>();
  const terminate = () => stopped.resolve("interrupted");
  const deadline = setTimeout(() => stopped.resolve("timed out"), timeoutMs);
  process.on("SIGTERM", terminate);
  process.on("SIGINT", terminate);
  let revoke: (() => Promise<boolean>) | undefined;
  try {
    const outcome = await Promise.race([
      run((callback) => {
        revoke = callback;
      }),
      stopped.promise,
    ]);
    if (typeof outcome === "number") return outcome;
    report(`Seed command ${outcome}.`);
    if (revoke) {
      const grace = Promise.withResolvers<boolean>();
      const timer = setTimeout(() => grace.resolve(false), graceMs);
      try {
        if (!(await Promise.race([revoke(), grace.promise])))
          report("Could not confirm revocation of the interrupted session.");
      } finally {
        clearTimeout(timer);
      }
    }
    return 1;
  } finally {
    clearTimeout(deadline);
    process.off("SIGTERM", terminate);
    process.off("SIGINT", terminate);
  }
}
