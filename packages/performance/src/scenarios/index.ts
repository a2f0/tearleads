import { runScenarioCommand } from "./command";

try {
  process.exit(await runScenarioCommand(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
