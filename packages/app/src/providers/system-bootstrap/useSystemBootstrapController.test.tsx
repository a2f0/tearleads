import { afterEach, expect, test } from "bun:test";
import {
  type ContainerContentsStore,
  createDomainScope,
  type Tearleads,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import type { RuntimeSnapshot } from "../sdk/TearleadsProvider";
import type { SystemBootstrapRunInput } from "./systemBootstrapRun";
import { useSystemBootstrapController } from "./useSystemBootstrapController";

afterEach(() => cleanup());

function bootstrapInput(targetKey: string): SystemBootstrapRunInput {
  const state: RuntimeSnapshot["state"] = {
    containerId: "root",
    domainScope: createDomainScope(),
    events: [],
    online: true,
  };
  return {
    appData: {
      auth: {
        authToken: null,
        isAuthenticated: true,
        organizationId: "org",
        userId: "user",
      },
      crypto: {
        encapsulationKeyPair: null,
        signingFingerprint: "fingerprint",
        signingKeyPair: null,
      },
      // The controller reads ownership, not these opaque runtime operations.
      infra: { dbId: "db", dbStatus: "ready" } as RuntimeSnapshot["infra"],
      state,
      util: {} as RuntimeSnapshot["util"],
    },
    bootstrapContacts: false,
    containerContentsStore: {} as ContainerContentsStore,
    systemContainers: [],
    targetKey,
    tearleads: {} as Tearleads,
  };
}

type PendingRun = ReturnType<typeof Promise.withResolvers<boolean>> & {
  readonly input: SystemBootstrapRunInput;
};

function controlledRuns() {
  const runs: PendingRun[] = [];
  let closing = false;
  const runBootstrap = (input: SystemBootstrapRunInput) => {
    const run = Promise.withResolvers<boolean>();
    runs.push({ input, ...run });
    if (closing) run.resolve(true);
    return run.promise;
  };
  return {
    runBootstrap,
    runs,
    async close() {
      closing = true;
      await act(async () => {
        for (const run of runs) run.resolve(true);
        await Promise.allSettled(runs.map((run) => run.promise));
      });
    },
  };
}

interface Props {
  readonly bootstrapInput: SystemBootstrapRunInput | null;
  readonly enabled: boolean;
}

function renderController(
  runBootstrap: (input: SystemBootstrapRunInput) => Promise<boolean>,
  initialProps: Props,
  options: { readonly strict?: boolean; readonly errors?: unknown[] } = {},
) {
  const logError = (message: string | Error, cause?: unknown) => {
    options.errors?.push({ message, cause });
  };
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

test.each([false, true])(
  "a missing-input epoch (enabled=%s) cannot complete after restoring the identical input",
  async (enabledWhileMissing) => {
    const f = controlledRuns();
    const original = bootstrapInput("same-target");
    const view = renderController(f.runBootstrap, {
      bootstrapInput: original,
      enabled: true,
    });
    try {
      await waitFor(() => expect(f.runs).toHaveLength(1));
      await act(async () =>
        view.rerender({ bootstrapInput: null, enabled: enabledWhileMissing }),
      );
      expect(view.result.current.status).toBe(
        enabledWhileMissing ? "running" : "idle",
      );
      await act(async () =>
        view.rerender({ bootstrapInput: original, enabled: true }),
      );
      expect(f.runs).toHaveLength(1);
      await act(async () => f.runs[0]?.resolve(true));
      expect(f.runs).toHaveLength(2);
      expect(f.runs[1]?.input).toBe(original);
      expect(view.result.current.status).toBe("running");
      await act(async () => f.runs[1]?.resolve(true));
      expect(view.result.current.status).toBe("ready");
    } finally {
      view.unmount();
      await f.close();
    }
  },
);

type OwnershipReplacement = "SDK" | "domain" | "container store";

function replaceBootstrapOwnership(
  input: SystemBootstrapRunInput,
  replacement: OwnershipReplacement,
): SystemBootstrapRunInput {
  if (replacement === "SDK") return { ...input, tearleads: {} as Tearleads };
  if (replacement === "container store") {
    return { ...input, containerContentsStore: {} as ContainerContentsStore };
  }
  return {
    ...input,
    appData: {
      ...input.appData,
      state: { ...input.appData.state, domainScope: createDomainScope() },
    },
  };
}

test.each(["SDK", "domain", "container store"] as const)(
  "completed bootstrap does not transfer to a replacement %s with the same target key",
  async (replacement) => {
    const { runBootstrap, runs } = controlledRuns();
    const original = bootstrapInput("same-target");
    const view = renderController(runBootstrap, {
      bootstrapInput: original,
      enabled: true,
    });
    try {
      await waitFor(() => expect(runs).toHaveLength(1));
      await act(async () => runs[0]?.resolve(true));
      expect(view.result.current.status).toBe("ready");
      const next = replaceBootstrapOwnership(original, replacement);
      expect(next.targetKey).toBe(original.targetKey);
      await act(async () =>
        view.rerender({ bootstrapInput: next, enabled: true }),
      );
      expect(runs).toHaveLength(2);
      expect(runs[1]?.input).toBe(next);
      expect(view.result.current.status).toBe("running");
      await act(async () => runs[1]?.resolve(true));
      expect(view.result.current.status).toBe("ready");
    } finally {
      view.unmount();
      await act(async () => {
        for (const run of runs) run.resolve(true);
      });
    }
  },
);

test("completed bootstrap survives incidental snapshots of the same owner", async () => {
  const { runBootstrap, runs } = controlledRuns();
  const original = bootstrapInput("stable-target");
  const view = renderController(runBootstrap, {
    bootstrapInput: original,
    enabled: true,
  });
  try {
    await waitFor(() => expect(runs).toHaveLength(1));
    await act(async () => runs[0]?.resolve(true));
    expect(view.result.current.status).toBe("ready");
    const next = {
      ...original,
      appData: {
        ...original.appData,
        state: { ...original.appData.state, online: false },
      },
    };
    await act(async () =>
      view.rerender({ bootstrapInput: next, enabled: true }),
    );
    expect(runs).toHaveLength(1);
    expect(view.result.current.status).toBe("ready");
    expect(await view.result.current.ensureBootstrapped()).toEqual({
      completed: true,
    });
    expect(runs).toHaveLength(1);
  } finally {
    view.unmount();
    await act(async () => {
      for (const run of runs) run.resolve(true);
    });
  }
});

test.each(["incomplete", "error"] as const)(
  "Strict Mode joins a single %s attempt without an unsolicited retry",
  async (outcome) => {
    const f = controlledRuns();
    const errors: unknown[] = [];
    const failure = new Error("bootstrap work failed");
    const view = renderController(
      f.runBootstrap,
      {
        bootstrapInput: bootstrapInput("stable-target"),
        enabled: true,
      },
      { strict: true, errors },
    );
    try {
      await waitFor(() => expect(f.runs).toHaveLength(1));
      await act(async () => {
        if (outcome === "error") f.runs[0]?.reject(failure);
        else f.runs[0]?.resolve(false);
      });
      // Do not await an accidentally started second attempt: assert first,
      // then let close auto-resolve every test-owned attempt on failure.
      expect(f.runs).toHaveLength(1);
      expect(view.result.current.status).toBe(
        outcome === "error" ? "error" : "waiting",
      );
      expect(view.result.current.error).toBe(
        outcome === "error" ? failure : null,
      );
      expect(errors).toEqual(
        outcome === "error"
          ? [
              {
                message: "Failed to bootstrap system containers",
                cause: failure,
              },
            ]
          : [],
      );
    } finally {
      view.unmount();
      await f.close();
    }
  },
);

test.each(["unmount", "disable"] as const)(
  "a queued replacement cannot resume after %s or log the superseded rejection",
  async (expiration) => {
    const f = controlledRuns();
    const errors: unknown[] = [];
    const view = renderController(
      f.runBootstrap,
      {
        bootstrapInput: bootstrapInput("a"),
        enabled: true,
      },
      { errors },
    );
    try {
      await waitFor(() => expect(f.runs).toHaveLength(1));
      const oldFlight = view.result.current.ensureBootstrapped();
      await act(async () =>
        view.rerender({ bootstrapInput: bootstrapInput("b"), enabled: true }),
      );
      const queued = view.result.current.ensureBootstrapped();
      expect(f.runs).toHaveLength(1);
      await act(async () => {
        if (expiration === "unmount") view.unmount();
        else view.rerender({ bootstrapInput: null, enabled: false });
      });
      const failure = new Error("superseded work failed");
      await act(async () => {
        f.runs[0]?.reject(failure);
        await oldFlight;
      });
      expect(f.runs).toHaveLength(1);
      expect(errors).toEqual([]);
      if (expiration === "disable")
        expect(view.result.current.status).toBe("idle");
      expect(await queued).toEqual({ completed: false, skipped: true });
    } finally {
      view.unmount();
      await f.close();
    }
  },
);
