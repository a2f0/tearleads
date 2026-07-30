import { expect } from "bun:test";

export function silenceExpectedTransientDiscoveryError(): () => void {
  const originalConsoleError = console.error;
  let expectedErrorCount = 0;

  console.error = (...args: unknown[]) => {
    const isExpectedDiscoveryFailure =
      args[0] === "Device-first reconciliation failed:" &&
      args.some(
        (arg) =>
          arg instanceof Error && arg.message === "transient discovery failure",
      );
    if (isExpectedDiscoveryFailure) {
      expectedErrorCount += 1;
      return;
    }

    originalConsoleError(...args);
  };

  return () => {
    console.error = originalConsoleError;
    expect(expectedErrorCount).toBe(1);
  };
}
