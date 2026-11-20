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
  let timedOut = false;
  let grace: ReturnType<typeof setTimeout> | undefined;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    // The CLI gives session revocation five seconds before exiting.
    grace = setTimeout(() => child.kill("SIGKILL"), 10_000);
  }, timeoutMs);
  const exitCode = await child.exited.finally(() => {
    clearTimeout(timer);
    clearTimeout(grace);
  });
  if (timedOut) throw new Error(`${phase} timed out after ${timeoutMs} ms.`);
  if (exitCode !== 0) throw new Error(`${phase} exited with code ${exitCode}.`);
}
