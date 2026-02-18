import type {
  DatabaseOperations,
  TerminalUtilities
} from '@tearleads/terminal';

export interface ConsoleTerminalDependencies {
  useDatabaseContext: () => DatabaseOperations;
  utilities: TerminalUtilities;
}

let dependencies: ConsoleTerminalDependencies | null = null;

export function setConsoleTerminalDependencies(
  next: ConsoleTerminalDependencies
): void {
  dependencies = next;
}

export function getConsoleTerminalDependencies(): ConsoleTerminalDependencies | null {
  return dependencies;
}
