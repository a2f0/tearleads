import { afterEach, expect, test } from "bun:test";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { SystemBootstrapRunInput } from "./systemBootstrapRun";
import { useSystemBootstrapController } from "./useSystemBootstrapController";

afterEach(() => cleanup());

function bootstrapInput(targetKey: string): SystemBootstrapRunInput {
  return { targetKey } as unknown as SystemBootstrapRunInput;
}

interface PendingRun {
  readonly input: SystemBootstrapRunInput;
  readonly resolve: (completed: boolean) => void;
}

function controlledRuns() {
  const runs: PendingRun[] = [];
  const runBootstrap = (input: SystemBootstrapRunInput) =>
    new Promise<boolean>((resolve) => {
      runs.push({ input, resolve });
    });
  return { runBootstrap, runs };
}

interface Props {
  readonly bootstrapInput: SystemBootstrapRunInput | null;
  readonly enabled: boolean;
}

function renderController(
  runBootstrap: (input: SystemBootstrapRunInput) => Promise<boolean>,
  initialProps: Props,
  options: { readonly strict?: boolean } = {},
) {
  const logError = () => undefined;
  return renderHook(
    (props: Props) =>
      useSystemBootstrapController({ ...props, logError, runBootstrap }),
    { initialProps, ...(options.strict ? { wrapper: StrictMode } : {}) },
  );
}

test("a run superseded by a missing input settles to waiting", async () => {
  const { runBootstrap, runs } = controlledRuns();
  const inputA = bootstrapInput("a");
  const { rerender, result } = renderController(runBootstrap, {
    bootstrapInput: inputA,
    enabled: true,
  });
  await waitFor(() => expect(runs).toHaveLength(1));
  expect(result.current.status).toBe("running");
  expect(result.current.isBootstrapping).toBe(true);

  // The prerequisites disappear while the run is in flight (e.g. the store
  // stops being ready); the run's result no longer applies to anything.
  rerender({ bootstrapInput: null, enabled: true });
  expect(result.current.status).toBe("running");
  await act(async () => {
    runs[0]?.resolve(true);
  });

  // Before the machine, the state stayed "running" (and the gate blocked)
  // until some later input arrived.
  expect(result.current.status).toBe("waiting");
  expect(result.current.isBootstrapping).toBe(false);
});

test("a run from before a reset cannot finish the newer run", async () => {
  const { runBootstrap, runs } = controlledRuns();
  const { rerender, result } = renderController(runBootstrap, {
    bootstrapInput: bootstrapInput("a"),
    enabled: true,
  });
  await waitFor(() => expect(runs).toHaveLength(1));

  rerender({ bootstrapInput: null, enabled: false });
  expect(result.current.status).toBe("idle");
  const inputB = bootstrapInput("b");
  rerender({ bootstrapInput: inputB, enabled: true });

  await act(async () => {
    runs[0]?.resolve(true);
  });
  await waitFor(() => expect(runs).toHaveLength(2));
  expect(runs[1]?.input).toBe(inputB);
  expect(result.current.status).toBe("running");

  await act(async () => {
    runs[1]?.resolve(true);
  });
  expect(result.current.status).toBe("ready");
});

test("a replacement input re-runs instead of keeping the first result", async () => {
  const { runBootstrap, runs } = controlledRuns();
  const { rerender, result } = renderController(runBootstrap, {
    bootstrapInput: bootstrapInput("a"),
    enabled: true,
  });
  await waitFor(() => expect(runs).toHaveLength(1));

  rerender({ bootstrapInput: bootstrapInput("b"), enabled: true });
  await act(async () => {
    runs[0]?.resolve(true);
  });
  await waitFor(() => expect(runs).toHaveLength(2));
  expect(result.current.status).toBe("running");

  await act(async () => {
    runs[1]?.resolve(false);
  });
  expect(result.current.status).toBe("waiting");
});

test("Strict Mode's mount, unmount, mount still finishes the run", async () => {
  const { runBootstrap, runs } = controlledRuns();
  const { result } = renderController(
    runBootstrap,
    { bootstrapInput: bootstrapInput("a"), enabled: true },
    { strict: true },
  );
  await waitFor(() => expect(runs.length).toBeGreaterThan(0));

  await act(async () => {
    for (const run of runs) run.resolve(true);
  });
  // The remount joins the in-flight run instead of starting a second one.
  expect(runs).toHaveLength(1);
  expect(result.current.status).toBe("ready");
  expect(result.current.error).toBeNull();
});
