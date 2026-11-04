import { runCli } from "./cli";
import { readSecret } from "./prompt";
import { createKeychainRecoveryKeyStore } from "./recoveryKeyStore";
import { targets } from "./targets";

if (process.platform !== "darwin") {
  console.error("tearleads keeps recovery keys in the macOS Keychain only.");
  process.exit(1);
}

const { TEARLEADS_TRACE } = process.env;
const exitCode = await runCli(process.argv.slice(2), {
  apiBaseUrl: (target) => targets[target],
  keyStore: createKeychainRecoveryKeyStore(),
  readRecoveryKey: readSecret,
  // Written directly, not through `console`, which tracing labels.
  stderr: (line) => process.stderr.write(`${line}\n`),
  stdout: (line) => process.stdout.write(`${line}\n`),
  traceByDefault: TEARLEADS_TRACE === "1",
});
// SDK background work can hold timers after dispose; the command is done.
process.exit(exitCode);
