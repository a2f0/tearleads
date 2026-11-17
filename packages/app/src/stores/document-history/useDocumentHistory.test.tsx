import { afterEach, expect, spyOn, test } from "bun:test";
import type {
  DocumentHistory,
  DocumentHistoryChange,
  DocumentHistoryStop,
  DocumentSummary,
  Tearleads,
} from "@tearleads/client-sdk";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import * as Runtime from "../../providers/sdk/TearleadsProvider";
import { useDocumentHistory } from "./useDocumentHistory";

const NO_CHANGE: DocumentHistoryChange = {
  attachments: { added: [], removed: [], replaced: [] },
  fields: [],
  kindChanged: false,
  rows: { added: [], changed: [], removed: [] },
  text: null,
};

const restorers: Array<() => void> = [];
afterEach(() => {
  cleanup();
  for (const restore of restorers.splice(0)) restore();
});

/** A capture whose stops are `[peer, endCounter]` pairs, oldest first. */
function capture(...ends: Array<[peerId: string, endCounter: number]>) {
  const closed = { count: 0 };
  const stops: DocumentHistoryStop[] = ends.map(
    ([peerId, endCounter], index) => ({
      committedAt: index * 1000,
      endCounter,
      index,
      peerId,
      startCounter: 0,
    }),
  );
  const history: DocumentHistory = {
    changeAt: () => NO_CHANGE,
    close: () => {
      closed.count += 1;
    },
    stops,
    versionAt: () => [],
    viewAt: (index) => ({
      attachments: [],
      documentKind: "note",
      fieldValidationIssues: [],
      rows: [],
      structuredFields: {},
      text: `stop ${index}`,
      title: `stop ${index}`,
    }),
  };
  return { closed, history };
}

function setup(dbStatus: "idle" | "ready" = "ready") {
  const runtime = {
    infra: { dbStatus, execSql: {} },
    state: { domainScope: {} as object },
  };
  const listeners = new Set<(document: DocumentSummary) => void>();
  const opens: string[] = [];
  // Every open reads its own capture, as the SDK does.
  let next: () => DocumentHistory | null = () => null;
  const documents = {
    openHistory: async (localId: string) => {
      opens.push(localId);
      return next();
    },
    subscribe: (listener: (document: DocumentSummary) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const sdkSpy = spyOn(Runtime, "useTearleads").mockReturnValue({
    documents,
  } as unknown as Tearleads);
  const runtimeSpy = spyOn(Runtime, "useTearleadsRuntime").mockImplementation(
    () => runtime as unknown as Runtime.RuntimeSnapshot,
  );
  restorers.push(
    () => sdkSpy.mockRestore(),
    () => runtimeSpy.mockRestore(),
  );
  return {
    opens,
    runtime,
    /** A save of `localId` became durable. */
    saved: (localId: string) => {
      for (const listener of [...listeners]) {
        listener({ id: localId } as DocumentSummary);
      }
    },
    /** What the document's durable history holds from now on. */
    serve: (make: () => DocumentHistory | null) => {
      next = make;
    },
    subscribers: () => listeners.size,
  };
}

test("history opens on its newest stop and replays it outside rendering", async () => {
  const sdk = setup();
  sdk.serve(() => capture(["1", 3], ["1", 5]).history);
  const { result } = renderHook(() => useDocumentHistory("doc"));

  await waitFor(() => {
    const { state } = result.current;
    expect(state.status).toBe("ready");
    if (state.status !== "ready") return;
    expect(state.selectedIndex).toBe(1);
    expect(state.shown?.view.text).toBe("stop 1");
  });

  act(() => result.current.step(-1));
  await waitFor(() => {
    const { state } = result.current;
    expect(state.status === "ready" && state.shown?.index).toBe(0);
  });
});

test("history stays loading until the database is ready", async () => {
  const sdk = setup("idle");
  sdk.serve(() => capture(["1", 3]).history);
  const { rerender, result } = renderHook(() => useDocumentHistory("doc"));

  await act(async () => undefined);
  // Not "unavailable": nothing has been read yet.
  expect(result.current.state.status).toBe("loading");
  expect(sdk.opens).toEqual([]);

  sdk.runtime.infra.dbStatus = "ready";
  rerender();
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  // The open, then one look for a save that slipped in behind it.
  await waitFor(() => expect(sdk.opens).toEqual(["doc", "doc"]));
});

test("a document that gains history after opening becomes available", async () => {
  const sdk = setup();
  sdk.serve(() => null);
  const { result } = renderHook(() => useDocumentHistory("doc"));
  await waitFor(() => expect(result.current.state.status).toBe("unavailable"));

  // A save that brings no history leaves the view as it is.
  act(() => sdk.saved("doc"));
  await act(async () => undefined);
  expect(result.current.state.status).toBe("unavailable");
  // Another document's save is not this one's.
  sdk.serve(() => capture(["1", 3]).history);
  act(() => sdk.saved("other"));
  await act(async () => undefined);
  expect(result.current.state.status).toBe("unavailable");

  act(() => sdk.saved("doc"));
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
});

test("an edit that extends an earlier writer's change is noticed as newer", async () => {
  const sdk = setup();
  sdk.serve(() => capture(["1", 3], ["2", 4]).history);
  const { result } = renderHook(() => useDocumentHistory("doc"));
  await waitFor(() => expect(result.current.state.status).toBe("ready"));

  // A save with the same history is not newer.
  sdk.serve(() => capture(["1", 3], ["2", 4]).history);
  act(() => sdk.saved("doc"));
  await act(async () => undefined);
  expect(result.current.state).toMatchObject({ newerAvailable: false });

  // Same number of stops and the same newest stop, but writer 1's change,
  // which is not the newest, now reaches further.
  sdk.serve(() => capture(["1", 6], ["2", 4]).history);
  act(() => sdk.saved("doc"));
  await waitFor(() =>
    expect(result.current.state).toMatchObject({ newerAvailable: true }),
  );
  // Once flagged, saves are no longer compared.
  expect(sdk.subscribers()).toBe(0);
});

test("a save between reading the capture and subscribing is still noticed", async () => {
  const sdk = setup();
  sdk.serve(() => capture(["1", 3]).history);
  const { result } = renderHook(() => useDocumentHistory("doc"));
  // The document is saved again before the hook has subscribed, so no
  // notification will ever reach it for this edit.
  sdk.serve(() => capture(["1", 3], ["1", 5]).history);

  await waitFor(() =>
    expect(result.current.state).toMatchObject({ newerAvailable: true }),
  );
});

test("history that arrives before the retry subscribes is still found", async () => {
  const sdk = setup();
  sdk.serve(() => null);
  const { result } = renderHook(() => useDocumentHistory("doc"));
  // The first read found none; the document hydrates before the hook has
  // subscribed for the retry.
  sdk.serve(() => capture(["1", 3]).history);

  await waitFor(() => expect(result.current.state.status).toBe("ready"));
});

test("a new domain scope reopens the history and listens there", async () => {
  const sdk = setup();
  sdk.serve(() => capture(["1", 3]).history);
  const { rerender, result } = renderHook(() => useDocumentHistory("doc"));
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  const opensBefore = sdk.opens.length;
  const runBefore = result.current.state.run;

  // Another signing identity: same database handle, same documents service.
  sdk.runtime.state.domainScope = {};
  rerender();

  await waitFor(() => {
    expect(result.current.state.status).toBe("ready");
    expect(result.current.state.run).toBeGreaterThan(runBefore);
  });
  expect(sdk.opens.length).toBeGreaterThan(opensBefore);
  // Saves announced from now on reach the reopened history.
  sdk.serve(() => capture(["1", 3], ["1", 5]).history);
  act(() => sdk.saved("doc"));
  await waitFor(() =>
    expect(result.current.state).toMatchObject({ newerAvailable: true }),
  );
});

test("reloading opens a new capture and closes the old one", async () => {
  const sdk = setup();
  const before: Array<ReturnType<typeof capture>> = [];
  sdk.serve(() => {
    const made = capture(["1", 3]);
    before.push(made);
    return made.history;
  });
  const { result, unmount } = renderHook(() => useDocumentHistory("doc"));
  await waitFor(() => expect(result.current.state.status).toBe("ready"));
  const [first] = before;
  if (!first) throw new Error("expected a capture");
  expect(result.current.state).toMatchObject({ history: first.history });

  const after: Array<ReturnType<typeof capture>> = [];
  sdk.serve(() => {
    const made = capture(["1", 3], ["1", 5]);
    after.push(made);
    return made.history;
  });
  act(() => result.current.reload());
  await waitFor(() =>
    expect(result.current.state).toMatchObject({ history: after[0]?.history }),
  );
  expect(first.closed.count).toBe(1);

  unmount();
  expect(after[0]?.closed.count).toBe(1);
  // Every capture read only to compare was closed as soon as it was read.
  await waitFor(() => {
    for (const made of [...before, ...after]) {
      expect(made.closed.count).toBe(1);
    }
  });
});
