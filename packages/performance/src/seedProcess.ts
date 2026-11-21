import { fileURLToPath } from "node:url";

/** Time the entire CLI lifetime, including sign-in and session revocation. */
export async function runSeedProcess(
  phase: string,
  argv: string[],
  recoveryKey: string,
  timeoutMs = 65 * 60_000,
) {
  const child = Bun.spawn(argv, {
    cwd: fileURLToPath(new URL("../../cli/", import.meta.url)),
    stdin: new TextEncoder().encode(recoveryKey),
    stdout: "inherit",
    stderr: "inherit",
  });
  const stopped = Promise.withResolvers<"timed out" | "interrupted">();
  const interrupt = () => stopped.resolve("interrupted");
  const timer = setTimeout(() => stopped.resolve("timed out"), timeoutMs);
  process.on("SIGTERM", interrupt);
  process.on("SIGINT", interrupt);
  try {
    const outcome = await Promise.race([child.exited, stopped.promise]);
    if (typeof outcome === "number") {
      if (outcome !== 0)
        throw new Error(`${phase} exited with code ${outcome}.`);
      return;
    }
    child.kill("SIGTERM");
    // Allow both the CLI sign-in and logout grace periods before killing it.
    const grace = setTimeout(() => child.kill("SIGKILL"), 15_000);
    try {
      await child.exited;
    } finally {
      clearTimeout(grace);
    }
    if (outcome === "timed out")
      throw new Error(`${phase} timed out after ${timeoutMs} ms.`);
    throw new Error(`${phase} interrupted.`);
  } finally {
    clearTimeout(timer);
    process.off("SIGTERM", interrupt);
    process.off("SIGINT", interrupt);
  }
}
