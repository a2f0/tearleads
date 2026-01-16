/**
 * Scrollable terminal output display.
 */

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { OutputLine, OutputLineType } from '../lib/types';

interface TerminalOutputProps {
  lines: OutputLine[];
  className?: string;
}

const lineTypeStyles: Record<OutputLineType, string> = {
  command: 'text-zinc-400',
  output: 'text-zinc-100',
  error: 'text-red-400',
  success: 'text-emerald-400'
};

export function TerminalOutput({ lines, className }: TerminalOutputProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new lines are added
  // biome-ignore lint/correctness/useExhaustiveDependencies: intentionally scroll on lines change
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [lines.length]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'flex-1 overflow-y-auto whitespace-pre-wrap break-words font-mono text-sm',
        className
      )}
      data-testid="terminal-output"
      role="log"
      aria-live="polite"
      aria-label="Terminal output"
    >
      {lines.map((line) => (
        <div key={line.id} className={lineTypeStyles[line.type]}>
          {line.content}
        </div>
      ))}
    </div>
  );
}
