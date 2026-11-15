import { afterEach, expect, test } from "bun:test";
import { deriveStableDocumentId } from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { CurrentSelfContactIdentity } from "./currentSelfContactIdentity";
import {
  SELF_CONTACT_IDENTITY_RETRY_DELAYS_MS,
  type SelfContactIdentitySource,
  type SelfContactIdentityView,
} from "./currentSelfContactIdentityState";
import { getSelfContactLocalId } from "./selfContact";
import {
  type SelfContactIdentityRetryScheduler,
  useSelfContactIdentitySource,
} from "./useSelfContactIdentitySource";

afterEach(cleanup);

async function identityFor(
  fingerprint: string,
): Promise<CurrentSelfContactIdentity> {
  const localId = getSelfContactLocalId(fingerprint);
  return {
    documentId: await deriveStableDocumentId(localId),
    localId,
    localIds: new Set([localId]),
  };
}

test("a replacement identity source is pending on its very first render", async () => {
  const identityA = await identityFor("identity-view-a");
  const identityB = await identityFor("identity-view-b");
  const readA = Promise.withResolvers<CurrentSelfContactIdentity>();
  const readB = Promise.withResolvers<CurrentSelfContactIdentity>();
  const sourceA: SelfContactIdentitySource = {
    availability: "available",
    isCurrent: () => current === sourceA,
    load: () => readA.promise,
    subscribe: () => () => undefined,
  };
  const sourceB: SelfContactIdentitySource = {
    ...sourceA,
    isCurrent: () => current === sourceB,
    load: () => readB.promise,
  };
  let current = sourceA;
  const renders: SelfContactIdentityView[] = [];
  const view = renderHook(
    ({ source }) => {
      const identity = useSelfContactIdentitySource(source);
      renders.push(identity);
      return identity;
    },
    { initialProps: { source: sourceA } },
  );
  try {
    expect(view.result.current.status).toBe("pending");
    await act(async () => {
      readA.resolve(identityA);
      await readA.promise;
    });
    expect(view.result.current.status).toBe("ready");
    renders.length = 0;
    current = sourceB;
    view.rerender({ source: sourceB });
    expect(renders[0]?.status).toBe("pending");
    expect(renders.every((state) => state.status === "pending")).toBe(true);
    await act(async () => {
      readB.resolve(identityB);
      await readB.promise;
    });
    expect(view.result.current).toMatchObject({
      status: "ready",
      identity: identityB,
    });
  } finally {
    await act(async () => {
      readA.resolve(identityA);
      readB.resolve(identityB);
      await Promise.all([readA.promise, readB.promise]);
    });
    view.unmount();
  }
});

test("admission joins a newer equivalent refresh without waiting for a superseded read", async () => {
  const identity = await identityFor("overlapping-refresh");
  let read = Promise.resolve(identity);
  let refresh: () => void = () => undefined;
  const source: SelfContactIdentitySource = {
    availability: "available",
    isCurrent: () => true,
    load: () => read,
    subscribe: (listener) => {
      refresh = listener;
      return () => undefined;
    },
  };
  const view = renderHook(() => useSelfContactIdentitySource(source));
  const stale = Promise.withResolvers<CurrentSelfContactIdentity>();
  let pending: Promise<unknown> | undefined;
  let calls = 0;
  try {
    await act(async () => {
      await read;
    });
    const retained = view.result.current;
    if (retained.status !== "ready")
      throw new Error("Identity did not resolve");
    await act(async () => {
      read = stale.promise;
      refresh();
    });
    pending = retained.runWhenCurrent(() => {
      calls += 1;
      return "admitted";
    });
    expect(calls).toBe(0);
    await act(async () => {
      read = Promise.resolve({
        ...identity,
        localIds: new Set(identity.localIds),
      });
      refresh();
      await read;
    });
    expect(calls).toBe(1);
    expect(await pending).toBe("admitted");
    expect(retained.isCurrent()).toBe(true);
    await act(async () => {
      stale.resolve({
        ...identity,
        localIds: new Set([...identity.localIds, "stale-alias"]),
      });
      await stale.promise;
    });
    expect(view.result.current).toMatchObject({ status: "ready", identity });
  } finally {
    await act(async () => {
      stale.resolve(identity);
      await Promise.allSettled([pending]);
    });
    view.unmount();
  }
});

test("equivalent metadata refreshes preserve the published identity view", async () => {
  const identity = await identityFor("stable-identity-view");
  const initial = Promise.resolve(identity);
  const entered = Promise.withResolvers<void>();
  const held = Promise.withResolvers<CurrentSelfContactIdentity>();
  let refreshing = false;
  let refresh: () => void = () => undefined;
  const source: SelfContactIdentitySource = {
    availability: "available",
    isCurrent: () => true,
    load: () => {
      if (!refreshing) return initial;
      entered.resolve();
      return held.promise;
    },
    subscribe: (listener) => {
      refresh = listener;
      return () => undefined;
    },
  };
  const view = renderHook(() => useSelfContactIdentitySource(source));
  try {
    await act(async () => {
      await initial;
    });
    const retained = view.result.current;
    expect(retained.status).toBe("ready");
    await act(async () => {
      refreshing = true;
      refresh();
      await entered.promise;
    });
    expect(view.result.current).toBe(retained);
    view.rerender();
    expect(view.result.current).toBe(retained);
    await act(async () => {
      held.resolve({ ...identity, localIds: new Set(identity.localIds) });
      await held.promise;
    });
    expect(view.result.current).toBe(retained);
  } finally {
    await act(async () => {
      held.resolve(identity);
      await held.promise;
    });
    view.unmount();
  }
});

for (const outcome of ["failed", "unmounted", "expired"] as const) {
  test(`${outcome} refresh releases admission without reviving its authority`, async () => {
    const identity = await identityFor(`refresh-${outcome}`);
    let current = true;
    let read = Promise.resolve(identity);
    let refresh: () => void = () => undefined;
    const source: SelfContactIdentitySource = {
      availability: "available",
      isCurrent: () => current,
      load: () => read,
      subscribe: (listener) => {
        refresh = listener;
        return () => undefined;
      },
    };
    const view = renderHook(() => useSelfContactIdentitySource(source));
    const held = Promise.withResolvers<CurrentSelfContactIdentity>();
    let pending: Promise<unknown> | undefined;
    let calls = 0;
    try {
      await act(async () => {
        await read;
      });
      const retained = view.result.current;
      if (retained.status !== "ready")
        throw new Error("Identity did not resolve");
      await act(async () => {
        read = held.promise;
        refresh();
      });
      expect(view.result.current.status).toBe("ready");
      pending = retained.runWhenCurrent(() => {
        calls += 1;
        return "written";
      });
      expect(calls).toBe(0);
      await act(async () => {
        if (outcome === "failed")
          held.reject(new Error("Metadata read failed"));
        else if (outcome === "unmounted") view.unmount();
        else {
          current = false;
          refresh();
        }
      });
      expect(await pending).toBeNull();
      expect(calls).toBe(0);
      expect(retained.isCurrent()).toBe(false);
      if (outcome === "failed") {
        expect(view.result.current.status).toBe("failed");
        await act(async () => {
          read = Promise.resolve(identity);
          refresh();
          await read;
        });
        expect(view.result.current.status).toBe("ready");
        expect(retained.isCurrent()).toBe(false);
      }
    } finally {
      await act(async () => {
        held.resolve(identity);
        await Promise.allSettled([held.promise, pending]);
      });
      view.unmount();
    }
  });
}

interface ManualRetry {
  readonly delayMs: number;
  readonly retry: () => void;
  state: "scheduled" | "cancelled" | "fired";
}

function manualRetries() {
  const timers: ManualRetry[] = [];
  const schedule: SelfContactIdentityRetryScheduler = (retry, delayMs) => {
    const timer: ManualRetry = { delayMs, retry, state: "scheduled" };
    timers.push(timer);
    return () => {
      if (timer.state === "scheduled") timer.state = "cancelled";
    };
  };
  const scheduled = () => timers.filter(({ state }) => state === "scheduled");
  return {
    schedule,
    scheduled,
    delays: () => scheduled().map(({ delayMs }) => delayMs),
    fireNext: () => {
      const [timer] = scheduled();
      if (!timer) throw new Error("No retry is scheduled");
      timer.state = "fired";
      timer.retry();
    },
  };
}

test("a transient failed read recovers to ready without a notification", async () => {
  const identity = await identityFor("transient-read-failure");
  const retries = manualRetries();
  let loads = 0;
  const source: SelfContactIdentitySource = {
    availability: "available",
    isCurrent: () => true,
    load: async () => {
      loads += 1;
      if (loads === 1) throw new Error("Metadata read failed");
      return identity;
    },
    subscribe: () => () => undefined,
  };
  const view = renderHook(() =>
    useSelfContactIdentitySource(source, retries.schedule),
  );
  try {
    await waitFor(() => expect(view.result.current.status).toBe("failed"));
    expect(retries.delays()).toEqual(
      SELF_CONTACT_IDENTITY_RETRY_DELAYS_MS.slice(0, 1),
    );
    await act(async () => retries.fireNext());
    await waitFor(() =>
      expect(view.result.current).toMatchObject({ status: "ready", identity }),
    );
    expect(loads).toBe(2);
    expect(retries.delays()).toEqual([]);
  } finally {
    view.unmount();
  }
});

test("a permanently failing read stops retrying after the bound", async () => {
  const retries = manualRetries();
  let loads = 0;
  let refresh: () => void = () => undefined;
  const source: SelfContactIdentitySource = {
    availability: "available",
    isCurrent: () => true,
    load: async () => {
      loads += 1;
      throw new Error("Metadata read failed");
    },
    subscribe: (listener) => {
      refresh = listener;
      return () => undefined;
    },
  };
  const view = renderHook(() =>
    useSelfContactIdentitySource(source, retries.schedule),
  );
  const settled = (expectedLoads: number) =>
    waitFor(() =>
      expect({ loads, status: view.result.current.status }).toEqual({
        loads: expectedLoads,
        status: "failed",
      }),
    );
  try {
    await settled(1);
    for (const [
      index,
      delayMs,
    ] of SELF_CONTACT_IDENTITY_RETRY_DELAYS_MS.entries()) {
      expect(retries.delays()).toEqual([delayMs]);
      await act(async () => retries.fireNext());
      await settled(index + 2);
    }
    expect(loads).toBe(SELF_CONTACT_IDENTITY_RETRY_DELAYS_MS.length + 1);
    expect(retries.delays()).toEqual([]);
    // The next identity notification starts a fresh read and retry budget.
    await act(async () => refresh());
    await settled(SELF_CONTACT_IDENTITY_RETRY_DELAYS_MS.length + 2);
    expect(retries.delays()).toEqual(
      SELF_CONTACT_IDENTITY_RETRY_DELAYS_MS.slice(0, 1),
    );
  } finally {
    view.unmount();
  }
});

for (const outcome of ["superseded", "unmounted", "expired"] as const) {
  test(`a retry ${outcome} before it fires neither reads nor publishes`, async () => {
    const identity = await identityFor(`stale-retry-${outcome}`);
    const retries = manualRetries();
    const held = Promise.withResolvers<CurrentSelfContactIdentity>();
    let current = true;
    let loads = 0;
    let read = (): Promise<CurrentSelfContactIdentity> =>
      Promise.reject(new Error("Metadata read failed"));
    let refresh: () => void = () => undefined;
    const source: SelfContactIdentitySource = {
      availability: "available",
      isCurrent: () => current,
      load: () => {
        loads += 1;
        return read();
      },
      subscribe: (listener) => {
        refresh = listener;
        return () => undefined;
      },
    };
    const renders: SelfContactIdentityView["status"][] = [];
    const view = renderHook(() => {
      const identityView = useSelfContactIdentitySource(
        source,
        retries.schedule,
      );
      renders.push(identityView.status);
      return identityView;
    });
    try {
      await waitFor(() => expect(view.result.current.status).toBe("failed"));
      const [stale] = retries.scheduled();
      if (!stale) throw new Error("No retry was scheduled");
      await act(async () => {
        if (outcome === "superseded") {
          read = () => held.promise;
          refresh();
        } else if (outcome === "unmounted") view.unmount();
        else current = false;
      });
      // Expiry is noticed lazily; its tag still refuses the retry below.
      expect(stale.state).toBe(
        outcome === "expired" ? "scheduled" : "cancelled",
      );
      const loadsBefore = loads;
      renders.length = 0;
      // A timer that fires despite cancellation must still be refused.
      await act(async () => stale.retry());
      expect({ loads, renders }).toEqual({ loads: loadsBefore, renders: [] });
      if (outcome === "superseded") {
        await act(async () => {
          held.resolve(identity);
          await held.promise;
        });
        expect(view.result.current).toMatchObject({
          status: "ready",
          identity,
        });
        expect(loads).toBe(2);
      }
    } finally {
      held.resolve(identity);
      view.unmount();
    }
  });
}

test("an absent source admits work only while its authority and lifetime hold", async () => {
  let current = true;
  let reads = 0;
  const source: SelfContactIdentitySource = {
    availability: "absent",
    isCurrent: () => current,
    load: async () => {
      reads += 1;
      throw new Error("An absent identity must not be read");
    },
    subscribe: () => {
      reads += 1;
      return () => undefined;
    },
  };
  const view = renderHook(() => useSelfContactIdentitySource(source));
  const absent = view.result.current;
  if (absent.status !== "absent")
    throw new Error(`Expected absent identity, got ${absent.status}`);
  expect(await absent.runWhenCurrent(() => "ran")).toBe("ran");
  view.rerender();
  expect(view.result.current).toBe(absent);
  expect(reads).toBe(0);

  current = false;
  view.rerender();
  expect(view.result.current.status).toBe("pending");
  expect(absent.isCurrent()).toBe(false);
  expect(await absent.runWhenCurrent(() => "ran")).toBeNull();

  current = true;
  view.unmount();
  expect(absent.isCurrent()).toBe(false);
  expect(await absent.runWhenCurrent(() => "ran")).toBeNull();
});
