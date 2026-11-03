import { runCli } from "./cli";
import { readSecret } from "./prompt";
import { createKeychainRecoveryKeyStore } from "./recoveryKeyStore";
import { targets } from "./targets";

if (process.platform !== "darwin") {
  console.error("tearleads keeps recovery keys in the macOS Keychain only.");
  process.exit(1);
}

const exitCode = await runCli(process.argv.slice(2), {
  apiBaseUrl: (target) => targets[target],
  keyStore: createKeychainRecoveryKeyStore(),
  readRecoveryKey: readSecret,
  stderr: (line) => console.error(line),
  stdout: (line) => console.log(line),
});
// SDK background work can hold timers after dispose; the command is done.
process.exit(exitCode);
