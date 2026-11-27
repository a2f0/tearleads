import { runStatementCommand } from "./command";

try {
  process.exit(await runStatementCommand(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
