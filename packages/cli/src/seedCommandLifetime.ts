export type RegisterSeedShutdown = (
  stop: () => Promise<boolean>,
  logoutStarted?: Promise<void>,
) => void;

async function awaitCleanup(
  stop: () => Promise<boolean>,
  logoutStarted: Promise<void> | undefined,
  graceMs: number,
): Promise<boolean> {
  const expired = Promise.withResolvers<boolean>();
  let timer = setTimeout(() => expired.resolve(false), graceMs);
  // Allow an outstanding sign-in to settle. Once we have its token, give
  // the logout request its own full grace period.
  let waiting = true;
  void logoutStarted?.then(() => {
    if (!waiting) return;
    clearTimeout(timer);
    timer = setTimeout(() => expired.resolve(false), graceMs);
  });
  try {
    return await Promise.race([stop(), expired.promise]);
  } finally {
    waiting = false;
    clearTimeout(timer);
  }
}

/**
 * One seed command owns the process and its in-memory database. `label`
 * names it when it is stopped: "<label> timed out." or "<label> interrupted."
 */
export async function runSeedCommandWithDeadline(
  run: (registerShutdown: RegisterSeedShutdown) => Promise<number>,
  report: (message: string) => void,
  {
    graceMs = 5_000,
    label = "Seed command",
    timeoutMs = 65 * 60_000,
  }: {
    readonly graceMs?: number;
    readonly label?: string;
    readonly timeoutMs?: number;
  } = {},
): Promise<number> {
  const stopped = Promise.withResolvers<string>();
  const terminate = () => stopped.resolve("interrupted");
  const deadline = setTimeout(() => stopped.resolve("timed out"), timeoutMs);
  process.on("SIGTERM", terminate);
  process.on("SIGINT", terminate);
  let logoutStarted: Promise<void> | undefined;
  let revoke: (() => Promise<boolean>) | undefined;
  try {
    const outcome = await Promise.race([
      run((callback, started) => {
        revoke = callback;
        logoutStarted = started;
      }),
      stopped.promise,
    ]);
    if (typeof outcome === "number") return outcome;
    report(`${label} ${outcome}.`);
    if (revoke && !(await awaitCleanup(revoke, logoutStarted, graceMs))) {
      report("Could not confirm revocation of the interrupted session.");
    }
    return 1;
  } finally {
    clearTimeout(deadline);
    process.off("SIGTERM", terminate);
    process.off("SIGINT", terminate);
  }
}
