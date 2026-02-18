import type { LogLevel } from '../stores/logStore';
import { logStore } from '../stores/logStore';

let installed = false;
type CapturedMethod = 'error' | 'warn' | 'info' | 'debug' | 'log';

const originalConsoleMethods: {
  error: typeof console.error | null;
  warn: typeof console.warn | null;
  info: typeof console.info | null;
  debug: typeof console.debug | null;
  log: typeof console.log | null;
} = {
  error: null,
  warn: null,
  info: null,
  debug: null,
  log: null
};

const CAPTURED_METHODS: CapturedMethod[] = [
  'error',
  'warn',
  'info',
  'debug',
  'log'
];

const CAPTURE_CONFIG: Record<
  CapturedMethod,
  { level: LogLevel; fallbackMessage: string }
> = {
  error: { level: 'error', fallbackMessage: 'Console error' },
  warn: { level: 'warn', fallbackMessage: 'Console warning' },
  info: { level: 'info', fallbackMessage: 'Console info' },
  debug: { level: 'debug', fallbackMessage: 'Console debug' },
  log: { level: 'info', fallbackMessage: 'Console log' }
};

function formatConsoleArg(arg: unknown): string {
  if (arg instanceof Error) {
    return arg.stack || arg.message;
  }
  if (typeof arg === 'string') {
    return arg;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function formatConsoleArgs(
  args: unknown[],
  fallbackMessage: string
): {
  message: string;
  details: string | undefined;
} {
  if (args.length === 0) {
    return { message: fallbackMessage, details: undefined };
  }

  if (args[0] instanceof Error) {
    const message = args[0].message || 'Console error';
    const details = args.map(formatConsoleArg).join(' ');
    return { message, details };
  }

  const formatted = args.map(formatConsoleArg);
  const message = formatted[0] || 'Console error';
  const details =
    formatted.length > 1 ? formatted.slice(1).join(' ') : undefined;

  return { message, details };
}

export function installConsoleErrorCapture(): () => void {
  if (installed) {
    return () => {};
  }

  installed = true;
  for (const method of CAPTURED_METHODS) {
    originalConsoleMethods[method] = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      const config = CAPTURE_CONFIG[method];
      const { message, details } = formatConsoleArgs(
        args,
        config.fallbackMessage
      );
      logStore.addLog(config.level, message, details);
      originalConsoleMethods[method]?.(...args);
    };
  }

  return () => {
    if (installed) {
      for (const method of CAPTURED_METHODS) {
        const originalMethod = originalConsoleMethods[method];
        if (originalMethod) {
          console[method] = originalMethod;
        }
        originalConsoleMethods[method] = null;
      }
    }
    installed = false;
  };
}
