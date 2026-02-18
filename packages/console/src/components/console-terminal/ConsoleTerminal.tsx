import {
  type DatabaseOperations,
  Terminal,
  type TerminalUtilities
} from '@tearleads/terminal';
import { cn } from '@tearleads/ui';
import { getConsoleTerminalDependencies } from '../../lib/terminalDependencies';

interface ConsoleTerminalProps {
  className?: string;
  autoFocus?: boolean;
}

interface ConfiguredConsoleTerminalProps extends ConsoleTerminalProps {
  useDatabaseContext: () => DatabaseOperations;
  utilities: TerminalUtilities;
}

function ConfiguredConsoleTerminal({
  className,
  autoFocus = true,
  useDatabaseContext,
  utilities
}: ConfiguredConsoleTerminalProps) {
  const db = useDatabaseContext();

  return (
    <Terminal
      db={db}
      utilities={utilities}
      autoFocus={autoFocus}
      {...(className ? { className } : {})}
    />
  );
}

export function ConsoleTerminal({
  className,
  autoFocus = true
}: ConsoleTerminalProps) {
  const dependencies = getConsoleTerminalDependencies();

  if (!dependencies) {
    return (
      <div
        className={cn(
          'flex h-[400px] min-h-[300px] items-center justify-center rounded-lg border text-muted-foreground text-sm',
          className
        )}
        data-testid="console-terminal-unconfigured"
      >
        Console terminal is not configured.
      </div>
    );
  }

  return (
    <ConfiguredConsoleTerminal
      className={className}
      autoFocus={autoFocus}
      useDatabaseContext={dependencies.useDatabaseContext}
      utilities={dependencies.utilities}
    />
  );
}
