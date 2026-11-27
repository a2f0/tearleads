import { runInventoryCommand } from "./command";

try {
  process.exit(await runInventoryCommand(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
