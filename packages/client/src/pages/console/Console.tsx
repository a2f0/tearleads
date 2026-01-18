import { Terminal as TerminalIcon } from 'lucide-react';
import { BackLink } from '@/components/ui/back-link';
import { Terminal } from './components/Terminal';

export function Console() {
  return (
    <div className="space-y-6 overflow-x-hidden">
      <div className="space-y-2">
        <BackLink defaultTo="/" defaultLabel="Back to Home" />
        <div className="flex items-center gap-3">
          <TerminalIcon className="h-8 w-8 text-muted-foreground" />
          <h1 className="font-bold text-2xl tracking-tight">Console</h1>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        Run database commands with a command-line interface. Type "help" for
        available commands.
      </p>
      <Terminal />
    </div>
  );
}
