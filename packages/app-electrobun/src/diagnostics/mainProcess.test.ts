import { expect, spyOn, test } from "bun:test";
import { pathToFileURL } from "node:url";
import {
  configureMainProcessDiagnostics,
  installMainProcessReporting,
  type MainProcessReporter,
} from "./mainProcess";

type Crash = (error: Error, origin: NodeJS.UncaughtExceptionOrigin) => void;

// Listeners are invoked directly, never emitted, so the test runner's own
// handlers are saved, removed, and restored around each case.
async function withProcessListeners(
  run: (shutdowns: [Error, string][]) => Promise<void>,
) {
  const crashes = process.listeners("uncaughtException");
  const rejections = process.listeners("unhandledRejection");
  const consoleError = spyOn(console, "error").mockImplementation(() => {});
  process.removeAllListeners("uncaughtException");
  process.removeAllListeners("unhandledRejection");
  const shutdowns: [Error, string][] = [];
  // The fake Electrobun shutdown listener is always registered first.
  process.on("uncaughtException", (error, origin) => {
    shutdowns.push([error, origin]);
  });
  try {
    await run(shutdowns);
  } finally {
    consoleError.mockRestore();
    process.removeAllListeners("uncaughtException");
    process.removeAllListeners("unhandledRejection");
    for (const listener of crashes) process.on("uncaughtException", listener);
    for (const listener of rejections)
      process.on("unhandledRejection", listener);
  }
}

function crashListener(): Crash {
  const [listener] = process.listeners("uncaughtException");
  if (!listener) throw new Error("Expected a crash listener");
  return listener;
}

function rejectionListener() {
  const [listener] = process.listeners("unhandledRejection");
  if (!listener) throw new Error("Expected a rejection listener");
  return listener;
}

function fakeReporter(overrides: Partial<MainProcessReporter> = {}) {
  const calls: string[] = [];
  let settle: (value: boolean) => void = () => {};
  const reporter: MainProcessReporter = {
    captureError: (_error, source) => {
      calls.push(`capture ${source}`);
    },
    flush: () => {
      calls.push("flush");
      return new Promise<boolean>((resolve) => {
        settle = resolve;
      });
    },
    ...overrides,
  };
  return { calls, reporter, settle: (value: boolean) => settle(value) };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("an unbundled main process configures nothing and leaves Electrobun's crash handling alone", async () => {
  await withProcessListeners(async () => {
    expect(
      configureMainProcessDiagnostics(
        pathToFileURL("/x/app/bun/index.js").href,
      ),
    ).toBeUndefined();
    expect(process.listenerCount("uncaughtException")).toBe(1);
    expect(process.listenerCount("unhandledRejection")).toBe(0);
  });
});

test("a crash is logged, reported, flushed, then handed to Electrobun's shutdown exactly once", async () => {
  await withProcessListeners(async (shutdowns) => {
    const { calls, reporter, settle } = fakeReporter();
    installMainProcessReporting(reporter);
    expect(process.listenerCount("uncaughtException")).toBe(1);
    const error = new TypeError("synthetic crash");
    crashListener()(error, "uncaughtException");
    expect(console.error).toHaveBeenCalledTimes(1);
    await tick();
    expect(calls).toEqual(["capture unhandled-error", "flush"]);
    expect(shutdowns).toEqual([]);
    settle(true);
    await tick();
    expect(shutdowns).toEqual([[error, "uncaughtException"]]);
    await tick();
    expect(shutdowns).toHaveLength(1);
  });
});

test("a second crash during the flush shuts down at once, and the flush settling does not repeat it", async () => {
  await withProcessListeners(async (shutdowns) => {
    const { reporter, settle } = fakeReporter();
    installMainProcessReporting(reporter);
    const listener = crashListener();
    listener(new Error("first"), "uncaughtException");
    await tick();
    const second = new Error("second");
    listener(second, "uncaughtException");
    expect(shutdowns).toEqual([[second, "uncaughtException"]]);
    settle(true);
    await tick();
    expect(shutdowns).toHaveLength(1);
  });
});

test("a crash whose report or flush throws still shuts down", async () => {
  for (const overrides of [
    {
      captureError: () => {
        throw new Error("capture failed");
      },
    },
    {
      flush: () => {
        throw new Error("flush failed");
      },
    },
    { flush: () => Promise.reject(new Error("flush rejected")) },
  ]) {
    await withProcessListeners(async (shutdowns) => {
      const { reporter, settle } = fakeReporter(overrides);
      installMainProcessReporting(reporter);
      crashListener()(new Error("crash"), "uncaughtException");
      await tick();
      settle(true);
      await tick();
      expect(shutdowns).toHaveLength(1);
    });
  }
});

test("a rejection is reported without shutdown, even when reporting throws", async () => {
  await withProcessListeners(async (shutdowns) => {
    const { calls, reporter } = fakeReporter();
    installMainProcessReporting(reporter);
    rejectionListener()(new RangeError("rejected"), Promise.resolve());
    expect(calls).toEqual(["capture unhandled-rejection"]);
    expect(shutdowns).toEqual([]);
  });
  await withProcessListeners(async (shutdowns) => {
    const { reporter } = fakeReporter({
      captureError: () => {
        throw new Error("capture failed");
      },
    });
    installMainProcessReporting(reporter);
    expect(() =>
      rejectionListener()(new RangeError("rejected"), Promise.resolve()),
    ).not.toThrow();
    expect(shutdowns).toEqual([]);
  });
});
