import { fileURLToPath } from "node:url";

/** Time the entire CLI lifetime, including sign-in and session revocation. */
export async function runSeedProcess(
  phase: string,
  argv: string[],
  recoveryKey: string,
  timeoutMs = 65 * 60_000,
) {
  const deadline = AbortSignal.timeout(timeoutMs);
  const child = Bun.spawn(argv, {
    cwd: fileURLToPath(new URL("../../cli/", import.meta.url)),
    stdin: new TextEncoder().encode(recoveryKey),
    stdout: "inherit",
    stderr: "inherit",
    signal: deadline,
    killSignal: "SIGKILL",
  });
  const exitCode = await child.exited;
  if (deadline.aborted)
    throw new Error(`${phase} timed out after ${timeoutMs} ms.`);
  if (exitCode !== 0) throw new Error(`${phase} exited with code ${exitCode}.`);
}
