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
