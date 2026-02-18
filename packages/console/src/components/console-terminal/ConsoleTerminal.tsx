import { Terminal } from '@tearleads/terminal';
import { cn } from '@tearleads/ui';
import { getConsoleTerminalDependencies } from '../../lib/terminalDependencies';

interface ConsoleTerminalProps {
  className?: string;
  autoFocus?: boolean;
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

  const db = dependencies.useDatabaseContext();

  return (
    <Terminal
      db={db}
      utilities={dependencies.utilities}
      autoFocus={autoFocus}
      {...(className ? { className } : {})}
    />
  );
}
