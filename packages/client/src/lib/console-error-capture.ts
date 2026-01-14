import { logStore } from '@/stores/logStore';

let installed = false;
let originalConsoleError: typeof console.error | null = null;

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

function formatConsoleArgs(args: Parameters<typeof console.error>): {
  message: string;
  details: string | undefined;
} {
  if (args.length === 0) {
    return { message: 'Console error', details: undefined };
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
  originalConsoleError = console.error.bind(console);

  console.error = (...args: Parameters<typeof console.error>) => {
    const { message, details } = formatConsoleArgs(args);
    logStore.error(message, details);
    originalConsoleError?.(...args);
  };

  return () => {
    if (installed && originalConsoleError) {
      console.error = originalConsoleError;
    }
    installed = false;
    originalConsoleError = null;
  };
}
