import { afterEach, expect, test } from "bun:test";
import { deriveStableDocumentId } from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { CurrentSelfContactIdentity } from "./currentSelfContactIdentity";
import type {
  SelfContactIdentitySource,
  SelfContactIdentityView,
} from "./currentSelfContactIdentityState";
import { getSelfContactLocalId } from "./selfContact";
import { useSelfContactIdentitySource } from "./useSelfContactIdentitySource";

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
    enabled: true,
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
    enabled: true,
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

for (const outcome of ["failed", "unmounted", "expired"] as const) {
  test(`${outcome} refresh releases admission without reviving its authority`, async () => {
    const identity = await identityFor(`refresh-${outcome}`);
    let current = true;
    let read = Promise.resolve(identity);
    let refresh: () => void = () => undefined;
    const source: SelfContactIdentitySource = {
      enabled: true,
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
