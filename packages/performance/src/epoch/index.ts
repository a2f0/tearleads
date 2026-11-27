import { runEpochCommand } from "./command";

try {
  process.exit(await runEpochCommand(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
