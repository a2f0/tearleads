import { logStore } from '@/stores/logStore';

let installed = false;
let originalConsoleError: typeof console.error | null = null;
let originalConsoleWarn: typeof console.warn | null = null;
let originalConsoleInfo: typeof console.info | null = null;
let originalConsoleDebug: typeof console.debug | null = null;
let originalConsoleLog: typeof console.log | null = null;

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

function formatConsoleArgs(args: unknown[], fallbackMessage: string): {
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
  originalConsoleError = console.error.bind(console);
  originalConsoleWarn = console.warn.bind(console);
  originalConsoleInfo = console.info.bind(console);
  originalConsoleDebug = console.debug.bind(console);
  originalConsoleLog = console.log.bind(console);

  console.error = (...args: Parameters<typeof console.error>) => {
    const { message, details } = formatConsoleArgs(args, 'Console error');
    logStore.error(message, details);
    originalConsoleError?.(...args);
  };

  console.warn = (...args: Parameters<typeof console.warn>) => {
    const { message, details } = formatConsoleArgs(args, 'Console warning');
    logStore.warn(message, details);
    originalConsoleWarn?.(...args);
  };

  console.info = (...args: Parameters<typeof console.info>) => {
    const { message, details } = formatConsoleArgs(args, 'Console info');
    logStore.info(message, details);
    originalConsoleInfo?.(...args);
  };

  console.debug = (...args: Parameters<typeof console.debug>) => {
    const { message, details } = formatConsoleArgs(args, 'Console debug');
    logStore.debug(message, details);
    originalConsoleDebug?.(...args);
  };

  console.log = (...args: Parameters<typeof console.log>) => {
    const { message, details } = formatConsoleArgs(args, 'Console log');
    logStore.info(message, details);
    originalConsoleLog?.(...args);
  };

  return () => {
    if (
      installed &&
      originalConsoleError &&
      originalConsoleWarn &&
      originalConsoleInfo &&
      originalConsoleDebug &&
      originalConsoleLog
    ) {
      console.error = originalConsoleError;
      console.warn = originalConsoleWarn;
      console.info = originalConsoleInfo;
      console.debug = originalConsoleDebug;
      console.log = originalConsoleLog;
    }
    installed = false;
    originalConsoleError = null;
    originalConsoleWarn = null;
    originalConsoleInfo = null;
    originalConsoleDebug = null;
    originalConsoleLog = null;
  };
}
