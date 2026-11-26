import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryVerification,
  DocumentHistoryVerificationOptions,
  DocumentHistoryVerificationReport,
  DocumentHistoryVersion,
  Tearleads,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook } from "@testing-library/react";
import * as Runtime from "../../providers/sdk/TearleadsProvider";
import { useDocumentHistoryVerification } from "./useDocumentHistoryVerification";

const restorers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const restore of restorers.splice(0)) restore();
});

const VERSION: DocumentHistoryVersion = [{ counter: 4, peerId: "1" }];
const REPORT: DocumentHistoryVerificationReport = {
  localVersion: VERSION,
  ranges: [],
  serverAhead: false,
  voidUpdateCount: 0,
};
const VERIFIED: DocumentHistoryVerification = { ...REPORT, status: "verified" };

/** A replay that counts how often it was closed. */
function replay(version: DocumentHistoryVersion = VERSION) {
  const closed = { count: 0 };
  const history: DocumentHistory = {
    changeAt: () => {
      throw new Error("not replayed here");
    },
    close: () => {
      closed.count += 1;
    },
    stops: [
      { committedAt: 0, endCounter: 5, index: 0, peerId: "1", startCounter: 0 },
    ],
    versionAt: () => version,
    viewAt: () => {
      throw new Error("not replayed here");
    },
  };
  return { closed, history };
}

/** A mismatch found on the device's history as it was at `localVersion`. */
function mismatch(
  signed: DocumentHistory,
  localVersion: DocumentHistoryVersion = VERSION,
): DocumentHistoryVerification {
  return { ...REPORT, localVersion, signed, status: "mismatch" };
}

interface Check {
  readonly localId: string;
  readonly options: DocumentHistoryVerificationOptions | undefined;
  readonly reject: (error: unknown) => void;
  readonly resolve: (result: DocumentHistoryVerification | null) => void;
}

/** The SDK, with each check held open until the test settles it. */
function setup(thrownAtOnce?: Error) {
  const checks: Check[] = [];
  const documents = {
    verifyHistory: (
      localId: string,
      options?: DocumentHistoryVerificationOptions,
    ) => {
      if (thrownAtOnce) throw thrownAtOnce;
      return new Promise<DocumentHistoryVerification | null>(
        (resolve, reject) => {
          checks.push({ localId, options, reject, resolve });
        },
      );
    },
  };
  const spy = spyOn(Runtime, "useTearleads").mockReturnValue({
    documents,
  } as unknown as Tearleads);
  restorers.push(() => spy.mockRestore());
  const initialProps: { capture: DocumentHistory | null } = {
    capture: replay().history,
  };
  const hook = renderHook(
    (props: { capture: DocumentHistory | null }) =>
      useDocumentHistoryVerification("doc", props.capture),
    { initialProps },
  );
  return {
    ...hook,
    /** The `index`th check the hook started. */
    check: (index: number) => {
      const check = checks[index];
      if (!check) throw new Error(`no check ${index}`);
      return check;
    },
    checks,
    state: () => hook.result.current.state,
    verify: () => act(() => hook.result.current.verify()),
  };
}

test("a check reports how far it has read, then its verdict", async () => {
  const hook = setup();
  expect(hook.state()).toEqual({ status: "idle" });
  // Nothing is checked until it is asked for.
  expect(hook.checks).toEqual([]);

  hook.verify();
  expect(hook.state()).toMatchObject({ progress: null, status: "checking" });
  expect(hook.check(0).localId).toBe("doc");

  act(() =>
    hook.check(0).options?.onProgress?.({ updatesRead: 64, updatesTotal: 90 }),
  );
  expect(hook.state()).toMatchObject({
    progress: { updatesRead: 64, updatesTotal: 90 },
    status: "checking",
  });

  await act(async () => hook.check(0).resolve(VERIFIED));
  expect(hook.state()).toMatchObject({ report: REPORT, status: "verified" });
});

test("a check left behind by a new capture cannot settle the next one", async () => {
  const hook = setup();
  hook.verify();
  const first = hook.check(0);

  // History reloads: another capture, and a check of that one.
  hook.rerender({ capture: replay().history });
  expect(hook.state()).toEqual({ status: "idle" });
  expect(first.options?.signal?.aborted).toBe(true);
  hook.verify();
  expect(hook.state()).toMatchObject({ status: "checking" });

  // The first check still comes back, with a replay nobody will show.
  const late = replay();
  act(() => first.options?.onProgress?.({ updatesRead: 1, updatesTotal: 1 }));
  await act(async () => first.resolve(mismatch(late.history)));
  expect(hook.state()).toMatchObject({ progress: null, status: "checking" });
  expect(late.closed.count).toBe(1);

  await act(async () => hook.check(1).resolve(VERIFIED));
  expect(hook.state()).toMatchObject({ status: "verified" });
  expect(hook.check(1).options?.signal?.aborted).toBe(false);
});

test("leaving stops a check in flight, and closes the replay it brings back", async () => {
  const hook = setup();
  hook.verify();
  const { options, resolve } = hook.check(0);
  expect(options?.signal?.aborted).toBe(false);

  hook.unmount();
  expect(options?.signal?.aborted).toBe(true);

  // The check had already built a signed replay when it was stopped.
  const late = replay();
  await act(async () => resolve(mismatch(late.history)));
  expect(late.closed.count).toBe(1);
});

test("leaving closes the signed replay of a mismatch", async () => {
  const hook = setup();
  const signed = replay();
  hook.verify();
  await act(async () => hook.check(0).resolve(mismatch(signed.history)));
  expect(hook.state()).toMatchObject({
    signed: signed.history,
    status: "mismatch",
  });
  expect(signed.closed.count).toBe(0);

  hook.unmount();
  expect(signed.closed.count).toBe(1);
});

test("checking again closes the signed replay of the mismatch before", async () => {
  const hook = setup();
  const signed = replay();
  hook.verify();
  await act(async () => hook.check(0).resolve(mismatch(signed.history)));

  hook.verify();
  expect(hook.state()).toMatchObject({ status: "checking" });
  expect(signed.closed.count).toBe(1);

  // Closed once: leaving later does not close it again.
  hook.unmount();
  expect(signed.closed.count).toBe(1);
});

test("a check that throws is a failure, and can be tried again", async () => {
  const hook = setup();
  hook.verify();
  await act(async () => hook.check(0).reject(new Error("database is closed")));
  expect(hook.state()).toMatchObject({
    message: "database is closed",
    status: "failed",
  });

  hook.verify();
  await act(async () => hook.check(1).resolve(VERIFIED));
  expect(hook.state()).toMatchObject({ status: "verified" });
});

test("a check that throws before it returns is a failure too", async () => {
  const hook = setup(new Error("database is not ready"));
  hook.verify();
  await act(async () => undefined);
  expect(hook.state()).toMatchObject({
    message: "database is not ready",
    status: "failed",
  });
});

test("a new capture forgets the verdict on the one before", async () => {
  const hook = setup();
  const signed = replay();
  hook.verify();
  await act(async () => hook.check(0).resolve(mismatch(signed.history)));
  expect(hook.state()).toMatchObject({ status: "mismatch" });

  // "Load newer edits", a restore, or another database or account.
  hook.rerender({ capture: replay().history });
  expect(hook.state()).toEqual({ status: "idle" });
  expect(signed.closed.count).toBe(1);

  // History is reloading: there is no capture to check.
  hook.rerender({ capture: null });
  hook.verify();
  expect(hook.state()).toEqual({ status: "idle" });
  expect(hook.checks).toHaveLength(1);
});

test("a database that is not ready ends the check as interrupted", async () => {
  const hook = setup();
  hook.verify();
  await act(async () => hook.check(0).resolve(null));

  expect(hook.state()).toMatchObject({
    reason: "interrupted",
    status: "unavailable",
  });
});

test("a verdict on a history newer than the capture is not applied to it", async () => {
  const hook = setup();
  const signed = replay();
  hook.verify();
  // An edit became durable after the capture was taken.
  await act(async () =>
    hook
      .check(0)
      .resolve(mismatch(signed.history, [{ counter: 9, peerId: "1" }])),
  );

  expect(hook.state()).toMatchObject({
    reason: "capture_outdated",
    status: "unavailable",
  });
  expect(signed.closed.count).toBe(1);
});
