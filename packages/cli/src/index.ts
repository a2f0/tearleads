import { runCli } from "./cli";
import type { CliContext } from "./cliContext";
import { readLine, readSecret } from "./prompt";
import { createKeychainRecoveryKeyStore } from "./recoveryKeyStore";
import { runSeedCommandWithDeadline } from "./seedCommandLifetime";
import { targets } from "./targets";

if (
  process.platform !== "darwin" &&
  !process.argv.slice(2).includes("--key-stdin")
) {
  console.error("tearleads keeps recovery keys in the macOS Keychain only.");
  process.exit(1);
}

const { TEARLEADS_TRACE } = process.env;
const argv = process.argv.slice(2);
const context: CliContext = {
  apiBaseUrl: (target) => targets[target],
  keyStore: createKeychainRecoveryKeyStore(),
  readLine,
  readRecoveryKey: readSecret,
  // Written directly, not through `console`, which tracing labels.
  stderr: (line) => process.stderr.write(`${line}\n`),
  stdout: (line) => process.stdout.write(`${line}\n`),
  traceByDefault: TEARLEADS_TRACE === "1",
};
const exitCode =
  argv.includes("seed") || argv.includes("verify-seed")
    ? await runSeedCommandWithDeadline(
        (registerShutdown) => runCli(argv, { ...context, registerShutdown }),
        context.stderr,
      )
    : await runCli(argv, context);
// SDK background work can hold timers after dispose; the command is done.
process.exit(exitCode);
